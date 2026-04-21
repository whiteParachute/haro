const timer = setInterval(() => {}, 1 << 30);

process.on('SIGTERM', () => {
  clearInterval(timer);
  process.exit(0);
});

process.on('SIGINT', () => {
  clearInterval(timer);
  process.exit(0);
});
