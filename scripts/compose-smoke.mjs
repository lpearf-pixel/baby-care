const targets = [
  { name: 'web', url: 'http://127.0.0.1:8080/', expectStatus: 200 },
  { name: 'api-via-web', url: 'http://127.0.0.1:8080/api/health', expectStatus: 200 },
];

const attempts = 30;
const delayMs = 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

for (const target of targets) {
  let last = 'not attempted';
  let ready = false;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(target.url, { signal: AbortSignal.timeout(3000) });
      last = `status=${response.status}`;
      if (response.status === target.expectStatus) {
        ready = true;
        break;
      }
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(delayMs);
  }

  if (!ready) {
    console.error(`SMOKE_FAILED component=${target.name} expected=${target.expectStatus} actual=${last}`);
    process.exit(1);
  }

  console.log(`SMOKE_OK component=${target.name}`);
}
