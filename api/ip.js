const TIMEOUT_MS = 5000;

function asObject(value) {
  return value && typeof value === "object" ? value : {};
}

function clean(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
}

function validIp(value) {
  const parts = value.split(".");
  if (
    parts.length === 4 &&
    parts.every((part) => /^\d+$/.test(part) && Number(part) <= 255)
  ) {
    return true;
  }

  return value.includes(":") && /^[0-9a-f:]+$/i.test(value) && value.length <= 45;
}

function requestIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "")
    .split(",")
    .map((value) => value.trim())
    .find(validIp);
  const direct = String(req.socket?.remoteAddress || "").replace(/^::ffff:/, "");
  return forwarded || (validIp(direct) ? direct : undefined);
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "merged-ip-api/1.0",
      },
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);
    return { status: response.status, data: asObject(await response.json()) };
  } finally {
    clearTimeout(timeout);
  }
}

function freeIpApiData(data) {
  return clean({
    ipVersion: data.ipVersion,
    ipAddress: data.ipAddress,
    latitude: data.latitude,
    longitude: data.longitude,
    countryName: data.countryName,
    countryCode: data.countryCode,
    capital: data.capital,
    phoneCodes: data.phoneCodes,
    timeZones: data.timeZones,
    zipCode: data.zipCode,
    cityName: data.cityName,
    regionName: data.regionName,
    regionCode: data.regionCode,
    continent: data.continent,
    continentCode: data.continentCode,
    currencies: data.currencies,
    languages: data.languages,
    asn: data.asn,
    asnOrganization: data.asnOrganization,
    isProxy: data.isProxy,
  });
}

function ipQueryData(data) {
  const isp = asObject(data.isp);
  const location = asObject(data.location);
  const risk = asObject(data.risk);

  return {
    ip: data.ip,
    isp: clean({
      asn: isp.asn,
      organization: isp.org,
      isp: isp.isp,
    }),
    location: clean({
      country: location.country,
      countryCode: location.country_code,
      city: location.city,
      state: location.state,
      zipcode: location.zipcode,
      latitude: location.latitude,
      longitude: location.longitude,
      timezone: location.timezone,
      localtime: location.localtime,
    }),
    risk: clean({
      isMobile: risk.is_mobile,
      isVpn: risk.is_vpn,
      isTor: risk.is_tor,
      isProxy: risk.is_proxy,
      isDatacenter: risk.is_datacenter,
      score: risk.risk_score,
    }),
  };
}

async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Only GET is supported.",
    });
  }

  const requestedIp =
    typeof req.query?.ip === "string" ? req.query.ip.trim() : undefined;

  if (requestedIp && !validIp(requestedIp)) {
    return res.status(400).json({
      success: false,
      error: "The ip query parameter must be a valid IPv4 or IPv6 address.",
    });
  }

  const ip = requestedIp || requestIp(req);
  const encodedIp = ip ? encodeURIComponent(ip) : "";

  const [freeResult, queryResult] = await Promise.allSettled([
    fetchJson(`https://free.freeipapi.com/api/v1/json/${encodedIp}`),
    fetchJson(`https://api.ipquery.io/${encodedIp}`),
  ]);

  const free = freeResult.status === "fulfilled" ? freeResult.value : null;
  const query = queryResult.status === "fulfilled" ? queryResult.value : null;

  if (!free && !query) {
    return res.status(502).json({
      success: false,
      error: "Both IP data providers are temporarily unavailable.",
    });
  }

  const freeSource = free ? freeIpApiData(free.data) : null;
  const querySource = query ? ipQueryData(query.data) : null;
  const location = querySource?.location || {};
  const isp = querySource?.isp || {};
  const risk = querySource?.risk || {};

  const response = {
    success: true,
    ip: free?.data.ipAddress || query?.data.ip || ip || "unknown",
    location: clean({
      country: free?.data.countryName || location.country,
      countryCode: free?.data.countryCode || location.countryCode,
      city: free?.data.cityName || location.city,
      region: free?.data.regionName || location.state,
      regionCode: free?.data.regionCode,
      postalCode: free?.data.zipCode || location.zipcode,
      continent: free?.data.continent,
      continentCode: free?.data.continentCode,
      capital: free?.data.capital,
      latitude: free?.data.latitude || location.latitude,
      longitude: free?.data.longitude || location.longitude,
      phoneCodes: free?.data.phoneCodes,
      timeZones: free?.data.timeZones,
      currencies: free?.data.currencies,
      languages: free?.data.languages,
      timezone: location.timezone,
      localtime: location.localtime,
    }),
    network: clean({
      asn: free?.data.asn || isp.asn,
      organization: free?.data.asnOrganization || isp.organization,
      isp: isp.isp,
    }),
    security: clean({
      isProxy: free?.data.isProxy ?? risk.isProxy,
      isMobile: risk.isMobile,
      isVpn: risk.isVpn,
      isTor: risk.isTor,
      isDatacenter: risk.isDatacenter,
      riskScore: risk.score,
    }),
    sources: clean({
      freeipapi: freeSource,
      ipquery: querySource,
    }),
    providerStatus: {
      freeipapi: { ok: Boolean(free), status: free?.status || null },
      ipquery: { ok: Boolean(query), status: query?.status || null },
    },
  };

  res.setHeader(
    "Cache-Control",
    "public, max-age=60, s-maxage=300, stale-while-revalidate=60",
  );
  return res.status(200).json(response);
}

module.exports = handler;
