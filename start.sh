#!/bin/sh

set -e

git pull
pnpm build
pm2 restart aaa
pm2 reset aaa
