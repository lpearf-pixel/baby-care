#if defined(__linux__)
#define _GNU_SOURCE
#endif

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

#if defined(__APPLE__)
#include <stdio.h>
#elif defined(__linux__)
#include <linux/fs.h>
#include <sys/random.h>
#include <sys/syscall.h>
#endif

#define PARENT_FD 3
#define TEMPORARY_FD 4

enum helper_status {
  STATUS_OK = 0,
  STATUS_PROTOCOL = 64,
  STATUS_UNSAFE = 65,
  STATUS_EXISTS = 66,
  STATUS_DURABILITY = 67,
  STATUS_UNAVAILABLE = 69,
  STATUS_OPERATION = 70,
  STATUS_QUARANTINED = 71,
  STATUS_QUARANTINE_FAILED = 72
};

enum operation_result {
  RESULT_OK = 0,
  RESULT_UNSAFE,
  RESULT_EXISTS,
  RESULT_DURABILITY,
  RESULT_UNAVAILABLE,
  RESULT_OPERATION,
  RESULT_QUARANTINED,
  RESULT_QUARANTINE_FAILED
};

static int stable_result(const char *message, int status) {
  size_t remaining = strlen(message);
  const char *cursor = message;
  while (remaining > 0U) {
    ssize_t written = write(STDOUT_FILENO, cursor, remaining);
    if (written < 0) {
      if (errno == EINTR) {
        continue;
      }
      break;
    }
    if (written == 0) {
      break;
    }
    cursor += written;
    remaining -= (size_t)written;
  }
  return status;
}

static int ascii_alphanumeric(char value) {
  return (value >= '0' && value <= '9') || (value >= 'A' && value <= 'Z') ||
         (value >= 'a' && value <= 'z');
}

static int valid_temporary_name(const char *name) {
  static const char prefix[] = ".baby-care-backup-tmp-";
  size_t prefix_length = sizeof(prefix) - 1U;
  size_t length = strlen(name);
  if (length != prefix_length + 6U || strncmp(name, prefix, prefix_length) != 0) {
    return 0;
  }
  for (size_t index = prefix_length; index < length; index += 1U) {
    if (!ascii_alphanumeric(name[index])) {
      return 0;
    }
  }
  return 1;
}

static int valid_final_name(const char *name) {
  static const char prefix[] = "baby-care-backup-";
  size_t prefix_length = sizeof(prefix) - 1U;
  size_t length = strlen(name);
  if (length != prefix_length + 16U || strncmp(name, prefix, prefix_length) != 0) {
    return 0;
  }
  for (size_t index = 0U; index < 16U; index += 1U) {
    char value = name[prefix_length + index];
    if (index == 8U) {
      if (value != 'T') {
        return 0;
      }
    } else if (index == 15U) {
      if (value != 'Z') {
        return 0;
      }
    } else if (value < '0' || value > '9') {
      return 0;
    }
  }
  return 1;
}

static int unexpected_descriptor_present(void) {
#if defined(__APPLE__)
  static const char descriptor_directory[] = "/dev/fd";
#elif defined(__linux__)
  static const char descriptor_directory[] = "/proc/self/fd";
#else
  return 1;
#endif
  DIR *directory = opendir(descriptor_directory);
  if (directory == NULL) {
    return 1;
  }
  int scanner_fd = dirfd(directory);
  int unexpected = 0;
  errno = 0;
  for (;;) {
    struct dirent *entry = readdir(directory);
    if (entry == NULL) {
      if (errno != 0) {
        unexpected = 1;
      }
      break;
    }
    char *end = NULL;
    errno = 0;
    long descriptor = strtol(entry->d_name, &end, 10);
    if (errno != 0 || end == entry->d_name || *end != '\0') {
      continue;
    }
    if (descriptor > TEMPORARY_FD && descriptor != scanner_fd) {
      unexpected = 1;
      break;
    }
  }
  if (closedir(directory) != 0) {
    unexpected = 1;
  }
  return unexpected;
}

static int private_directory(const struct stat *value) {
  return S_ISDIR(value->st_mode) && value->st_uid == geteuid() &&
         (value->st_mode & (mode_t)0777) == (mode_t)0700;
}

static int private_regular_file(const struct stat *value) {
  return S_ISREG(value->st_mode) && value->st_uid == geteuid() &&
         (value->st_mode & (mode_t)0777) == (mode_t)0600;
}

static int same_identity(const struct stat *left, const struct stat *right) {
  return left->st_dev == right->st_dev && left->st_ino == right->st_ino;
}

static int validate_directory_identity(const char *temporary_name) {
  struct stat parent;
  struct stat temporary;
  struct stat named_temporary;
  if (fstat(PARENT_FD, &parent) != 0 || fstat(TEMPORARY_FD, &temporary) != 0 ||
      fstatat(PARENT_FD, temporary_name, &named_temporary, AT_SYMLINK_NOFOLLOW) != 0) {
    return 0;
  }
  return private_directory(&parent) && private_directory(&temporary) &&
         private_directory(&named_temporary) && parent.st_dev == temporary.st_dev &&
         same_identity(&temporary, &named_temporary);
}

struct contract_entries {
  int database_dump;
  int manifest_json;
};

static int inspect_contract_entries(int require_complete, struct contract_entries *entries) {
  int inspection_fd = openat(TEMPORARY_FD, ".",
                             O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (inspection_fd < 0) {
    return 0;
  }
  DIR *directory = fdopendir(inspection_fd);
  if (directory == NULL) {
    (void)close(inspection_fd);
    return 0;
  }
  entries->database_dump = 0;
  entries->manifest_json = 0;
  int accepted = 1;
  errno = 0;
  for (;;) {
    struct dirent *entry = readdir(directory);
    if (entry == NULL) {
      if (errno != 0) {
        accepted = 0;
      }
      break;
    }
    if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0) {
      continue;
    }
    int *present = NULL;
    if (strcmp(entry->d_name, "database.dump") == 0) {
      present = &entries->database_dump;
    } else if (strcmp(entry->d_name, "manifest.json") == 0) {
      present = &entries->manifest_json;
    } else {
      accepted = 0;
      break;
    }
    struct stat child;
    if (*present != 0 ||
        fstatat(TEMPORARY_FD, entry->d_name, &child, AT_SYMLINK_NOFOLLOW) != 0 ||
        !private_regular_file(&child)) {
      accepted = 0;
      break;
    }
    *present = 1;
  }
  if (closedir(directory) != 0) {
    accepted = 0;
  }
  if (require_complete != 0 &&
      (entries->database_dump == 0 || entries->manifest_json == 0)) {
    accepted = 0;
  }
  return accepted;
}

static int exclusive_rename(int old_directory, const char *old_name, int new_directory,
                            const char *new_name) {
#if defined(__APPLE__)
  return renameatx_np(old_directory, old_name, new_directory, new_name, RENAME_EXCL);
#elif defined(__linux__)
  return (int)syscall(SYS_renameat2, old_directory, old_name, new_directory, new_name,
                      RENAME_NOREPLACE);
#else
  errno = ENOSYS;
  return -1;
#endif
}

static int unsupported_errno(int value) {
  return value == ENOSYS || value == EOPNOTSUPP || value == ENOTSUP;
}

static int fill_random(unsigned char *buffer, size_t length) {
#if defined(__APPLE__)
  arc4random_buf(buffer, length);
  return 1;
#elif defined(__linux__)
  size_t offset = 0U;
  while (offset < length) {
    ssize_t received = getrandom(buffer + offset, length - offset, 0U);
    if (received < 0) {
      if (errno == EINTR) {
        continue;
      }
      return 0;
    }
    if (received == 0) {
      return 0;
    }
    offset += (size_t)received;
  }
  return 1;
#else
  (void)buffer;
  (void)length;
  return 0;
#endif
}

static int quarantine_name(char *name, size_t size) {
  static const char prefix[] = ".baby-care-backup-quarantine-";
  static const char hexadecimal[] = "0123456789abcdef";
  unsigned char random[16];
  size_t prefix_length = sizeof(prefix) - 1U;
  if (size < prefix_length + sizeof(random) * 2U + 1U ||
      !fill_random(random, sizeof(random))) {
    return 0;
  }
  memcpy(name, prefix, prefix_length);
  for (size_t index = 0U; index < sizeof(random); index += 1U) {
    name[prefix_length + index * 2U] = hexadecimal[random[index] >> 4U];
    name[prefix_length + index * 2U + 1U] = hexadecimal[random[index] & 0x0fU];
  }
  name[prefix_length + sizeof(random) * 2U] = '\0';
  return 1;
}

static int final_entry_absent(const char *final_name) {
  struct stat ignored;
  if (fstatat(PARENT_FD, final_name, &ignored, AT_SYMLINK_NOFOLLOW) == 0) {
    return 0;
  }
  return errno == ENOENT;
}

static int durable_final_absence(const char *final_name, int inject_fsync_failure) {
#if defined(SAFE_BUNDLE_TESTING)
  if (inject_fsync_failure != 0) {
    errno = EIO;
    return 0;
  }
#else
  (void)inject_fsync_failure;
#endif
  if (fsync(PARENT_FD) != 0) {
    return 0;
  }
  return final_entry_absent(final_name);
}

static int quarantine_final_entry(const char *final_name, int inject_fsync_failure) {
  for (int attempt = 0; attempt < 16; attempt += 1) {
    char retained_name[96];
    if (!quarantine_name(retained_name, sizeof(retained_name))) {
      return 0;
    }
    if (exclusive_rename(PARENT_FD, final_name, PARENT_FD, retained_name) == 0) {
      return durable_final_absence(final_name, inject_fsync_failure);
    }
    if (errno == EEXIST || errno == ENOTEMPTY) {
      continue;
    }
    if (errno == ENOENT) {
      return durable_final_absence(final_name, inject_fsync_failure);
    }
    return 0;
  }
  return 0;
}

#if defined(SAFE_BUNDLE_TESTING)
static int inject_source_swap(const char *temporary_name) {
  static const char original_name[] = ".baby-care-helper-test-original";
  static const char replacement_name[] = ".baby-care-helper-test-replacement";
  if (mkdirat(PARENT_FD, replacement_name, (mode_t)0700) != 0) {
    return 0;
  }
  if (exclusive_rename(PARENT_FD, temporary_name, PARENT_FD, original_name) != 0) {
    return 0;
  }
  if (exclusive_rename(PARENT_FD, replacement_name, PARENT_FD, temporary_name) != 0) {
    return 0;
  }
  return 1;
}
#endif

static enum operation_result publish_bundle(const char *temporary_name,
                                             const char *final_name,
                                             int inject_swap,
                                             int inject_quarantine_fsync_failure) {
  struct contract_entries entries;
  if (!validate_directory_identity(temporary_name) ||
      !inspect_contract_entries(1, &entries) ||
      !validate_directory_identity(temporary_name)) {
    return RESULT_UNSAFE;
  }
  if (fsync(TEMPORARY_FD) != 0 || fsync(PARENT_FD) != 0) {
    return RESULT_DURABILITY;
  }
#if defined(SAFE_BUNDLE_TESTING)
  if (inject_swap != 0 && !inject_source_swap(temporary_name)) {
    return RESULT_OPERATION;
  }
#else
  (void)inject_swap;
#endif
  if (exclusive_rename(PARENT_FD, temporary_name, PARENT_FD, final_name) != 0) {
    int saved_errno = errno;
    if (saved_errno == EEXIST || saved_errno == ENOTEMPTY) {
      return RESULT_EXISTS;
    }
    if (unsupported_errno(saved_errno)) {
      return RESULT_UNAVAILABLE;
    }
    return RESULT_OPERATION;
  }
  struct stat opened;
  struct stat published;
  if (fstat(TEMPORARY_FD, &opened) != 0 ||
      fstatat(PARENT_FD, final_name, &published, AT_SYMLINK_NOFOLLOW) != 0 ||
      !same_identity(&opened, &published) || !private_directory(&published)) {
    return quarantine_final_entry(final_name, inject_quarantine_fsync_failure)
               ? RESULT_QUARANTINED
               : RESULT_QUARANTINE_FAILED;
  }
  if (fsync(PARENT_FD) != 0) {
    return quarantine_final_entry(final_name, inject_quarantine_fsync_failure)
               ? RESULT_QUARANTINED
               : RESULT_QUARANTINE_FAILED;
  }
  return RESULT_OK;
}

int main(int argc, char **argv) {
  if (unexpected_descriptor_present()) {
    return stable_result("safe_bundle_v1:protocol_error\n", STATUS_PROTOCOL);
  }
  if (argc == 4 && strcmp(argv[1], "publish") == 0 &&
      valid_temporary_name(argv[2]) && valid_final_name(argv[3])) {
    enum operation_result result = publish_bundle(argv[2], argv[3], 0, 0);
    if (result == RESULT_OK) {
      return stable_result("safe_bundle_v1:published\n", STATUS_OK);
    }
    if (result == RESULT_EXISTS) {
      return stable_result("safe_bundle_v1:exists\n", STATUS_EXISTS);
    }
    if (result == RESULT_DURABILITY) {
      return stable_result("safe_bundle_v1:durability_failed\n", STATUS_DURABILITY);
    }
    if (result == RESULT_UNAVAILABLE) {
      return stable_result("safe_bundle_v1:unavailable\n", STATUS_UNAVAILABLE);
    }
    if (result == RESULT_UNSAFE) {
      return stable_result("safe_bundle_v1:unsafe\n", STATUS_UNSAFE);
    }
    if (result == RESULT_QUARANTINED) {
      return stable_result("safe_bundle_v1:quarantined\n", STATUS_QUARANTINED);
    }
    if (result == RESULT_QUARANTINE_FAILED) {
      return stable_result("safe_bundle_v1:quarantine_failed\n", STATUS_QUARANTINE_FAILED);
    }
    return stable_result("safe_bundle_v1:operation_failed\n", STATUS_OPERATION);
  }
#if defined(SAFE_BUNDLE_TESTING)
  if (argc == 4 && strcmp(argv[1], "publish-source-swap-test") == 0 &&
      valid_temporary_name(argv[2]) && valid_final_name(argv[3])) {
    enum operation_result result = publish_bundle(argv[2], argv[3], 1, 0);
    if (result == RESULT_QUARANTINED) {
      return stable_result("safe_bundle_v1:quarantined\n", STATUS_QUARANTINED);
    }
    if (result == RESULT_QUARANTINE_FAILED) {
      return stable_result("safe_bundle_v1:quarantine_failed\n", STATUS_QUARANTINE_FAILED);
    }
    return stable_result("safe_bundle_v1:operation_failed\n", STATUS_OPERATION);
  }
  if (argc == 4 &&
      strcmp(argv[1], "publish-source-swap-quarantine-fsync-failure-test") == 0 &&
      valid_temporary_name(argv[2]) && valid_final_name(argv[3])) {
    enum operation_result result = publish_bundle(argv[2], argv[3], 1, 1);
    if (result == RESULT_QUARANTINE_FAILED) {
      return stable_result("safe_bundle_v1:quarantine_failed\n",
                           STATUS_QUARANTINE_FAILED);
    }
    return stable_result("safe_bundle_v1:operation_failed\n", STATUS_OPERATION);
  }
#endif
  return stable_result("safe_bundle_v1:protocol_error\n", STATUS_PROTOCOL);
}
