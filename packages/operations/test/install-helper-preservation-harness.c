#define main install_helper_main
#define read install_helper_test_read
#include "../native/install-helper.c"
#undef read
#undef main

ssize_t install_helper_test_read(int descriptor, void *buffer, size_t length) {
  (void)buffer;
  (void)length;
  if (descriptor != ARTIFACT_FD) {
    errno = EBADF;
    return -1;
  }

  static const char prefix[] = ".safe-bundle-install-";
  static const char retained_name[] = ".safe-bundle-installer-test-original";
  char temporary_name[128];
  temporary_name[0] = '\0';

  int duplicate = dup(BUILD_DIRECTORY_FD);
  if (duplicate >= 0) {
    DIR *directory = fdopendir(duplicate);
    if (directory != NULL) {
      for (;;) {
        struct dirent *entry = readdir(directory);
        if (entry == NULL) {
          break;
        }
        if (strncmp(entry->d_name, prefix, sizeof(prefix) - 1U) == 0 &&
            strlen(entry->d_name) < sizeof(temporary_name)) {
          (void)strncpy(temporary_name, entry->d_name, sizeof(temporary_name) - 1U);
          temporary_name[sizeof(temporary_name) - 1U] = '\0';
          break;
        }
      }
      (void)closedir(directory);
    } else {
      (void)close(duplicate);
    }
  }

  if (temporary_name[0] != '\0' &&
      renameat(BUILD_DIRECTORY_FD, temporary_name, BUILD_DIRECTORY_FD,
               retained_name) == 0) {
    int replacement = openat(BUILD_DIRECTORY_FD, temporary_name,
                             O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
                             (mode_t)0700);
    if (replacement >= 0) {
      static const char marker[] = "replacement";
      ssize_t marker_written = write(replacement, marker, sizeof(marker) - 1U);
      if (marker_written == (ssize_t)(sizeof(marker) - 1U)) {
        (void)fsync(replacement);
      }
      (void)close(replacement);
    }
  }

  errno = EIO;
  return -1;
}

int main(int argc, char **argv) {
  return install_helper_main(argc, argv);
}
