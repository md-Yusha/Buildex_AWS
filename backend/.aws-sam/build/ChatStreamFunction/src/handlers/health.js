export async function handler(event) {
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify({
      status: "ok",
      service: "BuildeX AWS Backend",
      timestamp: new Date().toISOString(),
      environment: process.env.AWS_REGION || "ap-south-1"
    })
  };
}
