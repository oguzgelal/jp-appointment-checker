import { launch } from "jsr:@astral/astral";
import { Resend } from "npm:resend";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const NOTIFY_EMAIL = Deno.env.get("NOTIFY_EMAIL")!;

if (!RESEND_API_KEY || !NOTIFY_EMAIL) {
  console.error("env variables missing");
  Deno.exit(1);
}

const resend = new Resend(RESEND_API_KEY);

const TARGET_URL =
  "https://www.keishicho-gto.metro.tokyo.lg.jp/keishicho-u/reserve/offerList_detail?tempSeq=445&accessFrom=offerList";

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
  await using browser = await launch();
  await using page = await browser.newPage(TARGET_URL);
  console.log(`Navigated to: ${TARGET_URL}`);

  // Wait for the page to settle
  await page.waitForNetworkIdle({ idleConnections: 0, idleTime: 1000 });

  let iteration = 0;
  while (true) {
    iteration++;
    console.log(`\n--- Check iteration ${iteration} ---`);

    // Step 2: Check for svg with aria-label="予約可能" inside table.time--table
    const hasReservation = await page.evaluate(() => {
      const table = document.querySelector("table.time--table");
      if (!table) return false;
      // const svg = table.querySelector(`svg[aria-label="予約可能"]`);
      const svg = document.querySelector(`svg[aria-label="予約可能"]`);
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

    // Step 4: Find the next button
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
      return { found: false, disabled: false };
    });

    if (!buttonState.found) {
      // Step 5: Button not found
      console.log("Next page button not found!");
      await sendEmail(
        "Next page button not found",
        `The '2週後＞' button was not found on the page. The page structure may have changed.`,
      );
      return;
    }

    if (buttonState.disabled) {
      // Step 7: Button is disabled — no more pages to check
      console.log("Next page button is disabled. No more pages to check.");
      return;
    }

    // Step 8: Click the button and continue
    console.log(`Clicking '2週後＞' button...`);
    await page.evaluate(() => {
      const inputs = document.querySelectorAll("input.button");
      for (const input of inputs) {
        if ((input as HTMLInputElement).value === "2週後＞") {
          (input as HTMLInputElement).click();
          return;
        }
      }
    });

    // Wait for navigation / page update
    await page.waitForNetworkIdle({ idleConnections: 0, idleTime: 1000 });
    console.log("Page updated, checking again...");
  }
}

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
  Deno.exit(1);
});
