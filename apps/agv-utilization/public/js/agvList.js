document.getElementById('loadAgvIDs').addEventListener("click", fetchAgvList);

async function fetchAgvList() {
    const SQL_CON_APIKEY = "bcc485148f97728f7f7468410cf23e591b94dab0c2fa1fb3717138f952f2d507"
    const API_BASE = `http://localhost:4000/api/v1`
    const RawResponse = await fetch(`${API_BASE}/agvIDs`, {
        method: "GET",
        headers: {
            "x-api-key": SQL_CON_APIKEY
    }
    });
    const JsonResponse = await RawResponse.json();

    console.log(JsonResponse)
    document.getElementById("AGVList").innerHTML = JSON.stringify(JsonResponse);
}