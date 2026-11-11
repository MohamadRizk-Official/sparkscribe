#!/usr/bin/env bash
# Makes today's README tick commits (30-45 per UTC day, random per day).
# Each commit toggles an invisible HTML comment at the end of README.md:
# add it, then remove it, and so on. Rendered README never changes.
set -euo pipefail

marker='<!-- . -->'
today=$(date -u +%Y-%m-%d)
hour=$((10#$(date -u +%H)))

# Daily total, 30..45, picked from the date so every run agrees on it.
seed=$(printf '%s' "$today" | cksum | cut -d' ' -f1)
total=$((30 + seed % 16))

# Spread the day's total evenly over 24 hourly runs and catch up on any
# runs that GitHub skipped or delayed.
target=$((total * (hour + 1) / 24))
done_today=$(git log --since="${today}T00:00:00Z" --grep='^chore: tick' --oneline | wc -l)
n=$((target - done_today))
if [ "$n" -le 0 ]; then
  echo "Nothing to do: $done_today of $total done, target for this hour is $target."
  exit 0
fi
echo "Daily total $total, making $n commit(s) now."

# Make sure README ends with a newline so the marker sits on its own line.
if [ -n "$(tail -c1 README.md)" ]; then
  echo >> README.md
fi

for _ in $(seq 1 "$n"); do
  if [ "$(tail -n1 README.md)" = "$marker" ]; then
    sed -i '$ d' README.md
  else
    printf '%s\n' "$marker" >> README.md
  fi
  git add README.md
  # [skip ci] stops Vercel from redeploying the site for a README tick.
  git commit -q -m "chore: tick [skip ci]"
done

git pull --rebase -q origin main
git push -q origin HEAD:main
