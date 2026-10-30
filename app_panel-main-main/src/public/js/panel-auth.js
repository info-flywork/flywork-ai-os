(function (global) {
  const ROLES = {
    SUPER_ADMIN: "SUPER_ADMIN",
    ADMIN: "ADMIN",
    USER: "USER"
  };

  const ROLE_LABELS = {
    SUPER_ADMIN: "Super Admin",
    ADMIN: "Admin",
    USER: "Kullanıcı"
  };

  let cachedUser = null;

  async function fetchSession() {
    const response = await fetch("/api/auth/me");
    if (response.status === 401) {
      window.location.href = "/login.html";
      return null;
    }
    const data = await response.json();
    cachedUser = data.user || null;
    return cachedUser;
  }

  function getCachedUser() {
    return cachedUser;
  }

  function isSuperAdmin(user) {
    return user?.role === ROLES.SUPER_ADMIN;
  }

  function isAdmin(user) {
    return user?.role === ROLES.ADMIN;
  }

  function isManager(user) {
    return isSuperAdmin(user) || isAdmin(user);
  }

  function isViewer(user) {
    return user?.role === ROLES.USER;
  }

  function roleLabel(role) {
    return ROLE_LABELS[role] || role || "—";
  }

  function applySidebarUser(user, options = {}) {
    const { badgeId = "userRoleBadge", nameId = "userNameLabel" } = options;
    const badge = document.getElementById(badgeId);
    const nameEl = document.getElementById(nameId);
    if (badge) {
      badge.textContent = roleLabel(user?.role);
      badge.dataset.role = user?.role || "";
    }
    if (nameEl) {
      nameEl.textContent = user?.name || user?.email || "";
    }
  }

  function toggleElements(selectors, visible) {
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((el) => {
        el.hidden = !visible;
        el.style.display = visible ? "" : "none";
      });
    }
  }

  global.PanelAuth = {
    ROLES,
    ROLE_LABELS,
    fetchSession,
    getCachedUser,
    isSuperAdmin,
    isAdmin,
    isManager,
    isViewer,
    roleLabel,
    applySidebarUser,
    toggleElements
  };
})(window);
