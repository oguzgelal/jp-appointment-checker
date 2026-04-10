import { launch } from "jsr:@astral/astral";
import { Resend } from "npm:resend";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const NOTIFY_EMAIL = Deno.env.get("NOTIFY_EMAIL")!;
const FAIL_COUNT_LIMIT = 5
const FAIL_COUNT_NEXT_CHECK_INCREASE_BY = 10
const ITERATION_MAX_COUNT = 20;
const TARGET_URL =
  "https://www.keishicho-gto.metro.tokyo.lg.jp/keishicho-u/reserve/offerList_detail?tempSeq=445&accessFrom=offerList";

let failCount = 0
let nextCheckInMins = getRandom(10, 30)

if (!RESEND_API_KEY || !NOTIFY_EMAIL) {
  console.error("env variables missing");
  Deno.exit(1);
}

const resend = new Resend(RESEND_API_KEY);

// inclusive
function getRandom(min: number, max: number) {
  const minCeiled = Math.ceil(min);
  const maxFloored = Math.floor(max);
  return Math.floor(Math.random() * (maxFloored - minCeiled + 1) + minCeiled);
}

// sleep for ms
function sleep(mins: number) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(true)
    }, mins * 60 * 1000)
  })
}

async function sendEmail(subject: string, body: string): Promise<void> {
  console.log(`Sending email: ${subject}`);
  const { error } = await resend.emails.send({
    from: "Reservation Checker <onboarding@resend.dev>",
    to: [NOTIFY_EMAIL],
    subject,
    html: `<p>${body}</p>`,
  });
  if (error) {
    console.error("Failed to send email:", error);
  } else {
    console.log("Email sent successfully");
  }
}

async function main() {
  console.log("Launching browser...");

  await using browser = await launch({ headless: true });
  await using page = await browser.newPage(TARGET_URL);

  console.log(`Navigated to: ${TARGET_URL}`);

  await page.waitForNetworkIdle({ idleConnections: 0, idleTime: 1000 });

  let iteration = 0;
  while (true) {
    if (iteration >= ITERATION_MAX_COUNT) {
      console.log(`Reached maximum iteration count. Exiting.`);
      return;
    }

    iteration++;
    console.log(`Checking page ${iteration}:`);

    // check for svg with aria-label="予約可能" inside `table.time--table` (appointment exists svg)
    const hasReservation = await page.evaluate(() => {
      const table = document.querySelector("table.time--table");
      if (!table) return false;
      // uncomment for testing happy path (it will find the available svg on the legend)
      // const svg = document.querySelector(`svg[aria-label="予約可能"]`);
      const svg = table.querySelector(`svg[aria-label="予約可能"]`);
      return svg !== null;
    });

    if (hasReservation) {
      console.log("Reservation available!");
      await sendEmail(
        `Reservation available!`,
        `A reservation slot was found on <b>page ${iteration}</b>. Next check in ${nextCheckInMins}min..<br><br>` +
          `<a href="${TARGET_URL}">Click here to book</a>`,
      );
      return;
    }

    console.log("No reservation found on this page.");

    // find the next button
    const buttonState = await page.evaluate(() => {
      const inputs = document.querySelectorAll("input.button");
      for (const input of inputs) {
        if ((input as HTMLInputElement).value === "2週後＞") {
          return {
            found: true,
            disabled: (input as HTMLInputElement).disabled,
          };
        }
      }
      return {
        found: false,
        disabled: false,
      };
    });

    if (!buttonState.found) {
      failCount++
      const title = "Next page button not found!"
      let msg = "Request likely blocked, or page structure chaged."
      if (failCount > FAIL_COUNT_LIMIT) {
        msg = `${msg}. Attempt limit reached, exiting.`
        console.log(title, msg)
        await sendEmail(title, msg);
        Deno.exit()
      } else {
        // increase next check in case of failure, as it's possible for the
        // page to break consecutively for a period of time
        nextCheckInMins += (failCount - 1) * FAIL_COUNT_NEXT_CHECK_INCREASE_BY
        msg = `${msg}. Attempt ${failCount}. Next check in ${nextCheckInMins}min...`
        console.log(title, msg)
        await sendEmail(title, msg);
        return;
      }
    }

    if (buttonState.disabled) {
      console.log("Next page button is disabled. No more pages to check.");
      // todo: should i send "not found" emails?
      // await sendEmail(
      //   `No reservations in ${iteration} pages. Next check in ${nextCheckInMins}min...`,
      //   `Checked all ${iteration} pages and found no reservations.`
      // );
      
      return;
    }

    // go to next page and try again
    console.log(`Clicking next button`);

    await page.evaluate(() => {
      const inputs = document.querySelectorAll("input.button");
      for (const input of inputs) {
        if ((input as HTMLInputElement).value === "2週後＞") {
          (input as HTMLInputElement).click();
          return;
        }
      }
    });

    await page.waitForNetworkIdle({
      idleConnections: 0,
      idleTime: 1000,
    });
  }
}

async function run() {
  console.log("Starting reservation check...");
  return await main().catch(async (err) => {
    console.error("Script error:", err);
    try {
      await sendEmail(
        "Reservation checker error",
        `The reservation checker script encountered an error:<br><pre>${String(err)}</pre>`,
      );
    } catch {
      // ignore email failure during error handling
    }
  });
};

while(true) {
  nextCheckInMins = getRandom(10, 30)
  await run();
  console.log(`Next check in ${nextCheckInMins} mins`)
  await sleep(nextCheckInMins)
}
