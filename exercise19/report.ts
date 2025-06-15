(async function sendAnswersToCentrala() {
  const centralaUrl = "https://c3ntrala.ag3nts.org/report";
  const apiKey = process.env.PERSONAL_API_KEY;

  // Convert answers array to required format

  const payload = {
    task: "webhook",
    apikey: apiKey,
    answer: "https://369d-109-243-64-76.ngrok-free.app/api/instruction",
  };

  console.log("\n🚀 Sending answers to Centrala...");

  try {
    const response = await fetch(centralaUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const responseData = await response.json();

    if (response.ok) {
      console.log("✅ Successfully sent answers to Centrala!");
      console.log("📥 Response:", responseData);
    } else {
      console.error("❌ Error sending answers to Centrala:");
      console.error("Status:", response.status);
      console.error("Response:", responseData);
    }
  } catch (error) {
    console.error("❌ Network error sending answers to Centrala:", error);
  }
})();
