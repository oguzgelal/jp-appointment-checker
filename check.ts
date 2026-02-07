/// <reference lib="deno.unstable" />

import { launch } from "jsr:@astral/astral";
import { Resend } from "npm:resend";

// 30 mins
const INTERVAL = 30 * 60 * 1000;

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const NOTIFY_EMAIL = Deno.env.get("NOTIFY_EMAIL")!;

// every 3 hours, send an email indicating the script is still running
const CHECK_IN_EMAIL_INTERVAL_SECS = 10800;

if (!RESEND_API_KEY || !NOTIFY_EMAIL) {
  console.error("env variables missing");
  Deno.exit(1);
}

const resend = new Resend(RESEND_API_KEY);

const ITERATION_MAX_COUNT = 20;
const TARGET_URL =
  "https://www.keishicho-gto.metro.tokyo.lg.jp/keishicho-u/reserve/offerList_detail?tempSeq=445&accessFrom=offerList";

let lastCheckInEmail = 0;

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

async function checkInEmail(): Promise<void> {
  const now = Date.now();
  if (
    !lastCheckInEmail ||
    now - lastCheckInEmail >= CHECK_IN_EMAIL_INTERVAL_SECS * 1000
  ) {
    console.log("Sending check-in email...");
    lastCheckInEmail = now;
    await sendEmail(
      "Reservation checker is running",
      "The reservation checker script is still running without errors.",
    );
  } else {
    console.log("Check-in email recently sent. Skipping.");
  }
}

async function main() {
  await checkInEmail();

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
        "Reservation available",
        `A reservation slot was found on the Tokyo driver's license conversion page.<br><br>` +
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
      console.log("Next page button not found!");
      await sendEmail(
        "Next page button not found",
        "Page structure likely chaged.",
      );
      return;
    }

    if (buttonState.disabled) {
      console.log("Next page button is disabled. No more pages to check.");
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

const run = () => {
  console.log("Starting reservation check...");
  main().catch(async (err) => {
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

run();
setInterval(run, INTERVAL);
