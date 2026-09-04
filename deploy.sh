#!/bin/sh

set -e

git pull
pnpm build
pm2 restart tpass-auth
pm2 reset tpass-auth
