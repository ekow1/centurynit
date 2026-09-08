const { spawn } = require('child_process');
const child = spawn('npm.cmd', ['run', 'db:generate'], { stdio: ['pipe', 'inherit', 'inherit'], shell: true });
const interval = setInterval(() => {
  child.stdin.write('\n');
}, 1000);
child.on('exit', () => {
  clearInterval(interval);
});
