const POLL_ENDPOINT =
  "https://swjyigjjoksqnsnvqtbu.supabase.co/functions/v1/poll-jobs";

export default {
  // Simple health endpoint for browser/manual checks
  async fetch() {
    return new Response(
      JSON.stringify({
        service: "job-radar-cron",
        status: "ok",
      }),
      {
        headers: { "Content-Type": "application/json" },
      }
    );
  },

  // Runs from Cloudflare Cron Trigger every 3 minutes
  async scheduled(event, env, ctx) {
    console.log("Job Radar cron fired", new Date().toISOString());

    try {
      const response = await fetch(POLL_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.JOB_RADAR_CRON_SECRET}`,
        },
        body: "{}",
      });

      const body = await response.text();

      if (!response.ok) {
        console.error(`Poll failed: ${response.status} ${body}`);
        return;
      }

      console.log(`Poll completed: ${body}`);
    } catch (error) {
      console.error(
        "Poll exception:",
        error instanceof Error ? error.message : String(error)
      );
    }
  },
};
