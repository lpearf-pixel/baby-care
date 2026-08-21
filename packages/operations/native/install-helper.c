#if defined(__linux__)
#define _GNU_SOURCE
#endif

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

#define BUILD_DIRECTORY_FD 3
#define ARTIFACT_FD 4
#define MAX_ARTIFACT_BYTES (1024U * 1024U)

enum installer_status {
  STATUS_OK = 0,
  STATUS_PROTOCOL = 64,
  STATUS_UNSAFE = 65,
  STATUS_DURABILITY = 67,
  STATUS_OPERATION = 70
};

enum install_result {
  RESULT_OK = 0,
  RESULT_UNSAFE,
  RESULT_DURABILITY,
  RESULT_OPERATION
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
    if (descriptor > ARTIFACT_FD && descriptor != scanner_fd) {
      unexpected = 1;
      break;
    }
  }
  if (closedir(directory) != 0) {
    unexpected = 1;
  }
  return unexpected;
}

static int private_build_directory(const struct stat *value) {
  return S_ISDIR(value->st_mode) && value->st_uid == geteuid() &&
         (value->st_mode & (mode_t)0777) == (mode_t)0700;
}

static int safe_artifact(const struct stat *value) {
  return S_ISREG(value->st_mode) && value->st_uid == geteuid() && value->st_size > 0 &&
         (unsigned long long)value->st_size <=
             (unsigned long long)MAX_ARTIFACT_BYTES &&
         (value->st_mode & (mode_t)0022) == (mode_t)0000;
}

static int same_identity(const struct stat *left, const struct stat *right) {
  return left->st_dev == right->st_dev && left->st_ino == right->st_ino;
}

static int write_all(int descriptor, const unsigned char *buffer, size_t length) {
  size_t offset = 0U;
  while (offset < length) {
    ssize_t written = write(descriptor, buffer + offset, length - offset);
    if (written < 0) {
      if (errno == EINTR) {
        continue;
      }
      return 0;
    }
    if (written == 0) {
      return 0;
    }
    offset += (size_t)written;
  }
  return 1;
}

static enum install_result install_artifact(const char *target_name,
                                            const char *temporary_name) {
  struct stat build_directory;
  struct stat source;
  if (fstat(BUILD_DIRECTORY_FD, &build_directory) != 0 ||
      fstat(ARTIFACT_FD, &source) != 0 ||
      !private_build_directory(&build_directory) || !safe_artifact(&source)) {
    return RESULT_UNSAFE;
  }
  if (lseek(ARTIFACT_FD, (off_t)0, SEEK_SET) < 0) {
    return RESULT_OPERATION;
  }

  int temporary_fd = openat(BUILD_DIRECTORY_FD, temporary_name,
                            O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
                            (mode_t)0700);
  if (temporary_fd < 0) {
    return RESULT_OPERATION;
  }

  enum install_result result = RESULT_OPERATION;
  unsigned long long copied = 0U;
  unsigned char buffer[16384];
  for (;;) {
    ssize_t received = read(ARTIFACT_FD, buffer, sizeof(buffer));
    if (received < 0) {
      if (errno == EINTR) {
        continue;
      }
      goto cleanup;
    }
    if (received == 0) {
      break;
    }
    if (!write_all(temporary_fd, buffer, (size_t)received)) {
      goto cleanup;
    }
    copied += (unsigned long long)received;
    if (copied > (unsigned long long)MAX_ARTIFACT_BYTES) {
      goto cleanup;
    }
  }
  if (copied != (unsigned long long)source.st_size ||
      fchmod(temporary_fd, (mode_t)0700) != 0 || fsync(temporary_fd) != 0) {
    result = RESULT_DURABILITY;
    goto cleanup;
  }
  struct stat copied_artifact;
  if (fstat(temporary_fd, &copied_artifact) != 0 ||
      !S_ISREG(copied_artifact.st_mode) || copied_artifact.st_uid != geteuid() ||
      (copied_artifact.st_mode & (mode_t)0777) != (mode_t)0700 ||
      copied_artifact.st_size != source.st_size) {
    result = RESULT_UNSAFE;
    goto cleanup;
  }
  if (close(temporary_fd) != 0) {
    temporary_fd = -1;
    result = RESULT_DURABILITY;
    goto cleanup;
  }
  temporary_fd = -1;
  if (renameat(BUILD_DIRECTORY_FD, temporary_name, BUILD_DIRECTORY_FD, target_name) != 0) {
    goto cleanup;
  }
  temporary_name = NULL;
  if (fsync(BUILD_DIRECTORY_FD) != 0) {
    return RESULT_DURABILITY;
  }

  struct stat named;
  int installed_fd = openat(BUILD_DIRECTORY_FD, target_name,
                            O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (installed_fd < 0 ||
      fstatat(BUILD_DIRECTORY_FD, target_name, &named, AT_SYMLINK_NOFOLLOW) != 0) {
    if (installed_fd >= 0) {
      (void)close(installed_fd);
    }
    return RESULT_UNSAFE;
  }
  struct stat installed;
  int accepted = fstat(installed_fd, &installed) == 0 &&
                 same_identity(&installed, &named) && S_ISREG(installed.st_mode) &&
                 installed.st_uid == geteuid() &&
                 (installed.st_mode & (mode_t)0777) == (mode_t)0700 &&
                 installed.st_size == source.st_size;
  if (close(installed_fd) != 0) {
    accepted = 0;
  }
  return accepted ? RESULT_OK : RESULT_UNSAFE;

cleanup:
  if (temporary_fd >= 0) {
    (void)close(temporary_fd);
  }
  if (temporary_name != NULL) {
    (void)unlinkat(BUILD_DIRECTORY_FD, temporary_name, 0);
  }
  return result;
}

int main(int argc, char **argv) {
  if (unexpected_descriptor_present() || argc != 2) {
    return stable_result("native_installer_v1:protocol_error\n", STATUS_PROTOCOL);
  }
  const char *target_name = NULL;
  const char *temporary_name = NULL;
  if (strcmp(argv[1], "install-production") == 0) {
    target_name = "safe-bundle";
    temporary_name = ".safe-bundle-install-production";
  } else if (strcmp(argv[1], "install-testing") == 0) {
    target_name = "safe-bundle-test";
    temporary_name = ".safe-bundle-install-testing";
  } else {
    return stable_result("native_installer_v1:protocol_error\n", STATUS_PROTOCOL);
  }
  enum install_result result = install_artifact(target_name, temporary_name);
  if (result == RESULT_OK) {
    return stable_result("native_installer_v1:installed\n", STATUS_OK);
  }
  if (result == RESULT_UNSAFE) {
    return stable_result("native_installer_v1:unsafe\n", STATUS_UNSAFE);
  }
  if (result == RESULT_DURABILITY) {
    return stable_result("native_installer_v1:durability_failed\n", STATUS_DURABILITY);
  }
  return stable_result("native_installer_v1:operation_failed\n", STATUS_OPERATION);
}
