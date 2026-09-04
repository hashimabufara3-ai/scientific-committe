export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const ORIGIN = "https://scientific-committe.onrender.com";
    const SECRET = env.ORIGIN_ACCESS_SECRET;

    if (!SECRET) {
      return new Response("Worker configuration error", {
        status: 500,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
        },
      });
    }

    const originHeaders = new Headers();

    const contentType = request.headers.get("Content-Type");
    const accept = request.headers.get("Accept");
    const userAgent = request.headers.get("User-Agent");

    if (contentType) {
      originHeaders.set("Content-Type", contentType);
    }

    if (accept) {
      originHeaders.set("Accept", accept);
    }

    if (userAgent) {
      originHeaders.set("User-Agent", userAgent);
    }

    const nextAction = request.headers.get("Next-Action");

    if (nextAction) {
      originHeaders.set("Next-Action", nextAction);
    }

    originHeaders.set("X-Origin-Access-Secret", SECRET);

    const cfConnectingIp = request.headers.get("CF-Connecting-IP");
    const trueClientIp = request.headers.get("True-Client-IP");
    const cfIpCountry = request.headers.get("CF-IPCountry");
    const cfRay = request.headers.get("CF-Ray");

    if (cfConnectingIp) {
      originHeaders.set("CF-Connecting-IP", cfConnectingIp);
      originHeaders.set("X-Forwarded-For", cfConnectingIp);
    }

    if (trueClientIp) {
      originHeaders.set("True-Client-IP", trueClientIp);
    }

    if (cfIpCountry) {
      originHeaders.set("CF-IPCountry", cfIpCountry);
    }

    if (cfRay) {
      originHeaders.set("CF-Ray", cfRay);
    }

    const originUrl = `${ORIGIN}${url.pathname}${url.search}`;

    const requestInit = {
      method: request.method,
      headers: originHeaders,
      redirect: "manual",
    };

    if (request.method !== "GET" && request.method !== "HEAD") {
      requestInit.body = request.body;
    }

    const originResponse = await fetch(originUrl, requestInit);

    if (
      originResponse.status >= 300 &&
      originResponse.status < 400
    ) {
      const location = originResponse.headers.get("Location");

      if (location) {
        const redirectUrl = new URL(location, ORIGIN);

        if (
          redirectUrl.hostname ===
          "scientific-committe.onrender.com"
        ) {
          redirectUrl.protocol = url.protocol;
          redirectUrl.host = url.host;
        }

        const responseHeaders = new Headers(
          originResponse.headers
        );

        responseHeaders.set(
          "Location",
          redirectUrl.toString()
        );

        return new Response(null, {
          status: originResponse.status,
          headers: responseHeaders,
        });
      }
    }

    return originResponse;
  },
};
