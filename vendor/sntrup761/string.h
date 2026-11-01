/* Stand-in for <string.h> in the freestanding build (no sysroot): the two functions glue.c defines. */
#ifndef STRING_H_STUB
#define STRING_H_STUB
#include <stddef.h>
void *memcpy(void *dst, const void *src, size_t n);
void *memset(void *dst, int c, size_t n);
#endif
