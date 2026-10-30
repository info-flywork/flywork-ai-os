const { requestExternalUrl } = require("./externalApi");
const { buildAppApiEndpoints, joinApiPath } = require("./appApi");
const { buildPanelHeaders } = require("./panelAuth");
const { extractCustomerAttributes } = require("./revenuecatApi");

function externalRequestOptions(app, options = {}) {
  return {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...buildPanelHeaders(app)
    }
  };
}

async function fetchResolveRcUser(app, params) {
  const endpoints = buildAppApiEndpoints(app);
  if (!endpoints.base) {
    return { ok: false, error: "API taban URL tanimli degil." };
  }

  const url = new URL(joinApiPath(endpoints.base, "/users/resolve-rc"));
  for (const [key, value] of Object.entries(params)) {
    if (value != null && String(value).trim() !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  return requestExternalUrl(url.toString(), externalRequestOptions(app, { expectJson: true }));
}

async function fetchUserDetails(app, userId) {
  const endpoints = buildAppApiEndpoints(app);
  if (!endpoints.base) {
    return { ok: false, error: "API taban URL tanimli degil." };
  }

  const url = joinApiPath(endpoints.base, `/users/${encodeURIComponent(userId)}/details`);
  return requestExternalUrl(url, externalRequestOptions(app, { expectJson: true }));
}

/**
 * RevenueCat müşteri kimliğini panel API üzerinden uygulama kullanıcısına bağlar.
 */
async function resolveAppUserForRcCustomer(app, { customerId, customer, aliasIds = [] }) {
  const attributes = customer ? extractCustomerAttributes(customer) : {};
  const email = attributes.$email || attributes.email || null;

  const resolveResult = await fetchResolveRcUser(app, {
    customerId,
    email: email || undefined,
    aliasIds: aliasIds.length ? aliasIds.join(",") : undefined
  });

  if (!resolveResult.ok || !resolveResult.bodyJson?.matched) {
    return {
      matched: false,
      user: null,
      matchStrategy: null,
      resolveError: resolveResult.error || null
    };
  }

  const user = resolveResult.bodyJson.user;
  let details = null;
  if (user?.id != null) {
    const detailsResult = await fetchUserDetails(app, user.id);
    if (detailsResult.ok) {
      details = detailsResult.bodyJson;
    }
  }

  return {
    matched: true,
    user,
    details,
    matchStrategy: resolveResult.bodyJson.matchStrategy || null,
    resolveError: null
  };
}

module.exports = {
  resolveAppUserForRcCustomer
};
