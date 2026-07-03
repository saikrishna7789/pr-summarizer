chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

    console.log("=== BACKGROUND RECEIVED ===");
    console.log(request);

    if (request.type !== "OLLAMA") return;

    (async () => {
        try {

            const response = await fetch(`${request.ollamaUrl}/api/generate`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: request.model,
                    prompt: request.prompt,
                    stream: false
                })
            });

            console.log("STATUS:", response.status);

            const text = await response.text();

            console.log("BODY:", text);

            if (!response.ok) {
                sendResponse({
                    success: false,
                    error: text
                });
                return;
            }

            sendResponse({
                success: true,
                response: JSON.parse(text).response
            });

        } catch (e) {

            console.error(e);

            sendResponse({
                success: false,
                error: e.message
            });

        }
    })();

    return true;
});