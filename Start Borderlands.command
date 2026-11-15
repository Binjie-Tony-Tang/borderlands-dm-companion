#!/bin/sh
# Finder can start this from any working directory, including a folder with spaces.
borderlands_dir=$(CDPATH= cd "$(dirname "$0")" && pwd) || exit 1
cd "$borderlands_dir" || exit 1

if ! command -v python3 >/dev/null 2>&1 ||
   ! python3 -c 'import sys; raise SystemExit(sys.version_info < (3, 9))' >/dev/null 2>&1; then
    printf '%s\n' 'Borderlands needs Python 3.9 or later. Install Python 3 for macOS, then try again.'
    printf '%s' 'Press Return to close this window. '
    read -r borderlands_reply
    exit 1
fi

python3 "$borderlands_dir/launch_borderlands.py" "$@"
borderlands_code=$?
if [ "$borderlands_code" -ne 0 ]; then
    printf '\n%s\n' 'Borderlands could not start. See the error above.'
    printf '%s' 'Press Return to close this window. '
    read -r borderlands_reply
fi
exit "$borderlands_code"
