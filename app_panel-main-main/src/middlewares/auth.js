const jwt = require("jsonwebtoken");
const env = require("../config/env");

const ROLES = {
  SUPER_ADMIN: "SUPER_ADMIN",
  ADMIN: "ADMIN",
  USER: "USER"
};

function authRequired(req, res, next) {
  const token = req.cookies?.token;
  const isApiRequest = req.originalUrl.startsWith("/api/");

  if (!token) {
    if (isApiRequest) {
      return res.status(401).json({ message: "Oturum bulunamadi." });
    }
    return res.redirect("/login.html");
  }

  try {
    const payload = jwt.verify(token, env.jwt.secret);
    req.user = payload;
    return next();
  } catch (error) {
    if (isApiRequest) {
      return res.status(401).json({ message: "Gecersiz oturum." });
    }
    return res.redirect("/login.html");
  }
}

function requireRoles(...roles) {
  const allowed = new Set(roles);

  return (req, res, next) => {
    if (!req.user?.role || !allowed.has(req.user.role)) {
      return res.status(403).json({ message: "Bu islem icin yetkiniz yok." });
    }
    return next();
  };
}

function isSuperAdmin(role) {
  return role === ROLES.SUPER_ADMIN;
}

function isManagerRole(role) {
  return [ROLES.SUPER_ADMIN, ROLES.ADMIN].includes(role);
}

function pageRoleGuard(...roles) {
  const allowed = new Set(roles);

  return (req, res, next) => {
    if (!req.user?.role || !allowed.has(req.user.role)) {
      return res.redirect("/panel?forbidden=1");
    }
    return next();
  };
}

module.exports = {
  ROLES,
  authRequired,
  requireRoles,
  isSuperAdmin,
  isManagerRole,
  pageRoleGuard
};
