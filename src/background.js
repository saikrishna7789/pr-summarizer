console.log("Background Loaded");

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

    if (request.type !== "OLLAMA") {
        return;
    }

    (async () => {

        try {

            console.log("Incoming Request:", request);

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

            console.log("HTTP Status:", response.status);

            const body = await response.text();

            console.log("Raw Body:", body);

            if (!response.ok) {
                sendResponse({
                    success: false,
                    error: body
                });
                return;
            }

            const json = JSON.parse(body);

            sendResponse({
                success: true,
                response: json.response
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