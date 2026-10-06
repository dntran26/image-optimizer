'use strict';

// Runs automatically before `npm start` (the "prestart" script) and pulls the latest
// version, so everyone stays current just by restarting the app.
// It never stops the app from starting: if anything gets in the way (offline, no GitHub
// access, local edits), it prints a short note and the app starts on the version it has.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
// Never let git sit waiting for a password prompt
const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };

function git(args) {
  return execFileSync('git', args, { cwd: root, env, timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] })
    .toString().trim();
}

// Not a git clone, or no remote branch to pull from: nothing to do
try {
  git(['rev-parse', '--abbrev-ref', '@{u}']);
} catch {
  process.exit(0);
}

process.stdout.write('Checking for updates... ');
try {
  const before = git(['rev-parse', 'HEAD']);
  git(['pull', '--ff-only', '--quiet']);
  const after = git(['rev-parse', 'HEAD']);

  if (before === after) {
    console.log('up to date');
  } else {
    const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    console.log(`updated to v${version}`);

    // Only reinstall when the dependency list actually changed
    const changed = git(['diff', '--name-only', before, after]).split('\n');
    if (changed.includes('package.json') || changed.includes('package-lock.json')) {
      console.log('Installing dependencies...');
      execFileSync('npm', ['install', '--silent'], { cwd: root, stdio: 'inherit', timeout: 300000 });
    }
  }
} catch (err) {
  // git's real error, not the "hint:" advice lines it prints around it
  const lines = err.stderr ? err.stderr.toString().trim().split('\n') : [];
  const reason = lines.find(l => l && !l.startsWith('hint:')) || err.message;
  console.log(`skipped (${reason})`);
  console.log('Starting the version you already have.');
}
