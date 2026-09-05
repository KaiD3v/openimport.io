#!/bin/sh
set -eu

if [ -z "${FRONTEND_FRAME_ANCESTORS:-}" ]; then
  echo "FRONTEND_FRAME_ANCESTORS is required" >&2
  exit 1
fi

# Reject CR/LF. Do not capture newlines via $(...); trailing LF is stripped by
# command substitution, so nl=$(printf '\n') becomes empty on POSIX/BusyBox.
# Octal escapes in tr are portable on BusyBox: CR=\015, LF=\012.
stripped=$(printf '%s' "${FRONTEND_FRAME_ANCESTORS}" | tr -d '\015\012')
if [ "${stripped}" != "${FRONTEND_FRAME_ANCESTORS}" ]; then
  echo "FRONTEND_FRAME_ANCESTORS contains forbidden characters" >&2
  exit 1
fi

# Reject '*' and ';' before CSP substitution.
case "${FRONTEND_FRAME_ANCESTORS}" in
  *'*'*|*';'*)
    echo "FRONTEND_FRAME_ANCESTORS contains forbidden characters" >&2
    exit 1
    ;;
esac

# Tokenize on whitespace and validate each token.
# shellcheck disable=SC2086
set -- ${FRONTEND_FRAME_ANCESTORS}
if [ "$#" -eq 0 ]; then
  echo "FRONTEND_FRAME_ANCESTORS is empty after trim" >&2
  exit 1
fi

for token in "$@"; do
  case "$token" in
    "'self'")
      ;;
    "'none'")
      if [ "$#" -ne 1 ]; then
        echo "FRONTEND_FRAME_ANCESTORS 'none' must be the only token" >&2
        exit 1
      fi
      ;;
    https:|http:|data:|blob:)
      echo "FRONTEND_FRAME_ANCESTORS rejects broad scheme sources" >&2
      exit 1
      ;;
    http://*|https://*)
      # Strip scheme before path/query/fragment checks so "https://" is not
      # mistaken for a path separator match on the full token.
      rest="${token#*://}"
      case "$rest" in
        ''|*'/'*|*'?'*|*'#'*|*'@'*)
          echo "FRONTEND_FRAME_ANCESTORS must be origins without path" >&2
          exit 1
          ;;
      esac
      ;;
    *)
      echo "FRONTEND_FRAME_ANCESTORS token is not supported" >&2
      exit 1
      ;;
  esac
done

# Allows unit/integration tests to exercise this script without starting nginx.
if [ "${VALIDATE_ONLY:-0}" = "1" ]; then
  exit 0
fi

envsubst '${FRONTEND_FRAME_ANCESTORS}' < /etc/nginx/nginx.conf.template > /tmp/nginx.conf
exec nginx -c /tmp/nginx.conf -g 'daemon off;'
