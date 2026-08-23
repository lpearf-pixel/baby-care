#define main safe_bundle_main
#define opendir safe_bundle_test_opendir
#include "../native/safe-bundle.c"
#undef opendir
#undef main

DIR *safe_bundle_test_opendir(const char *path) {
  (void)path;
  errno = EACCES;
  return NULL;
}

int main(int argc, char **argv) {
  return safe_bundle_main(argc, argv);
}
