const pm2 = require("pm2");

const blacklistedError = "error";
const errorThreshold = 5;
const logLineLimit = 50;
const waitTimeBeforeRestart = 10000; // 3 minutes in milliseconds

let isWaitingForRestart = false; // Flag to pause log checks during wait time

// Function to monitor logs of an instance and stop after capturing 30 lines
function monitorLogsAndRestart(miners) {
  let errorCount = 0;
  let logLineCount = 0;
  const instanceName = miners.find((e) => e.status == true).pm_id;
  const restartInstance1 = miners.find((e) => e.status == false).pm_id;

  pm2.connect((err) => {
    if (err) {
      console.error(`Error connecting to PM2: ${err}`);
      process.exit(2);
    }

    pm2.launchBus((err, bus) => {
      if (err) {
        console.error(`Error launching PM2 bus: ${err}`);
        process.exit(2);
      }

      console.log(`Monitoring logs for ${instanceName}...`);

      bus.on("log:out", (packet) => {
        if (
          packet.process.pm_id == instanceName &&
          logLineCount < logLineLimit
        ) {
          const logLine = packet.data;
          logLineCount++;

          // Check if the log contains the blacklisted error
          if (logLine.toLowerCase().includes(blacklistedError)) {
            errorCount++;
            console.log(`Detected error in ${instanceName}: ${logLine.trim()}`);
          }

          // Stop monitoring after capturing 30 lines
          if (logLineCount >= logLineLimit) {
            console.log(
              `Captured ${logLineLimit} lines for ${instanceName}. Stopping log monitoring...`
            );
            bus.close();

            // If error count exceeds threshold, initiate a 3-minute wait before restarting
            if (errorCount > errorThreshold) {
              console.log(
                `${instanceName} has ${errorCount} blacklisted errors. Waiting 3 minutes before restarting ${restartInstance1}...`
              );
              waitAndRestart(miners);
            } else {
              console.log(
                `No need to restart based on logs from ${instanceName}.`
              );
            }
          }
        }
      });
    });
  });
}

// Function to wait for 3 minutes and then restart the instance
function waitAndRestart(miners) {
  isWaitingForRestart = true; // Set flag to pause log checks during wait time

  // Wait for 3 minutes before restarting
  setTimeout(() => {
    restartInstance(miners);
    isWaitingForRestart = false; // Reset the flag to resume log checks after restart
  }, waitTimeBeforeRestart);
}

// Function to restart instances
const delay = (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};
const getlistpm2 = async () => {
  return new Promise((resolve, reject) => {
    // Connect to PM2
    pm2.connect((err) => {
      if (err) {
        return reject("Failed to connect to PM2: " + err);
      }

      // List all processes
      pm2.list((err, list) => {
        if (err) {
          pm2.disconnect(); // Disconnect from PM2
          return reject("Error fetching PM2 process list: " + err);
        }

        // Map the process details to a cleaner format
        const processList = list.map((proc) => ({
          name: proc.name,
          status: proc.pm2_env.status == "online",
          pm_id: proc.pm_id,
          memory: proc.monit.memory,
          cpu: proc.monit.cpu,
        }));

        // Disconnect from PM2 and resolve the list
        pm2.disconnect();
        resolve(processList);
      });
    });
  });
};
const restartInstance = async (miners) => {
  const runningProc = miners.find((e) => e.status == true).pm_id;
  const stoppedProc = miners.find((e) => e.status == false).pm_id;
  console.log("Stopping instance: ", runningProc);
  await pm2.stop(runningProc);
  console.log(await getlistpm2());
  console.log("delaying 10sec ");
  await delay(10000);
  console.log("Restarting instance: ", stoppedProc);
  await pm2.restart(stoppedProc);
  console.log(await getlistpm2());
  await pm2.disconnect();
};

const args = process.argv.slice(2);
const runLogChecks = async () => {
  const procList = args.map((arg) => Number(arg));
  const listpm2 = await getlistpm2();
  const listMiner = listpm2.filter((proc) => procList.includes(proc.pm_id));
  if (isWaitingForRestart) {
    console.log("Waiting for restart, log check paused...");
    return;
  }
  console.log("Starting new log check cycle...");
  monitorLogsAndRestart(listMiner);
};

// Start the interval to check logs every minute
setInterval(runLogChecks, 60 * 1000);

// Run the first check immediately
runLogChecks();
