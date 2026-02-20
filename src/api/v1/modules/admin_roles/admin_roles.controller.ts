const prisma = require("../../../../infrastructure/db/prismaClient");

exports.list = async (req, res) => {
  try {
    const rows = await prisma.role.findMany({
      orderBy: { key: "asc" },
      include: {
        rolePermissions: {
          include: { permission: { select: { id: true, key: true, label: true } } },
        },
      },
    });
    const data = rows.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.label,
      label: r.label,
      scope: r.scope,
      isSystem: r.isSystem,
      permissions: (r.rolePermissions || []).map((rp) => ({
        permissionId: rp.permissionId,
        permission: rp.permission,
      })),
    }));
    return res.json({ success: true, data });
  } catch (e) {
    console.error("admin_roles.list error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.create = async (req, res) => {
  try {
    const key = String(req.body?.key || "").trim().toUpperCase().replace(/\s+/g, "_");
    const name = String(req.body?.name || req.body?.label || "").trim() || key;
    if (!key) return res.status(400).json({ success: false, message: "key is required" });

    const existing = await prisma.role.findUnique({ where: { key } });
    if (existing) return res.status(409).json({ success: false, message: "Role key already exists" });

    const role = await prisma.role.create({
      data: { key, label: name, scope: "ORG", isSystem: false },
      include: {
        rolePermissions: { include: { permission: { select: { id: true, key: true } } } },
      },
    });
    return res.status(201).json({
      success: true,
      data: {
        id: role.id,
        key: role.key,
        name: role.label,
        permissions: (role.rolePermissions || []).map((rp) => ({ permissionId: rp.permissionId, permission: rp.permission })),
      },
    });
  } catch (e) {
    console.error("admin_roles.create error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.update = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const current = await prisma.role.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ success: false, message: "Not found" });
    if (current.isSystem) return res.status(403).json({ success: false, message: "System roles cannot be edited" });

    const key = req.body?.key !== undefined ? String(req.body.key).trim().toUpperCase().replace(/\s+/g, "_") : undefined;
    const name = req.body?.name !== undefined || req.body?.label !== undefined
      ? String(req.body?.name || req.body?.label || "").trim()
      : undefined;

    if (key && key !== current.key) {
      const exists = await prisma.role.findUnique({ where: { key } });
      if (exists) return res.status(409).json({ success: false, message: "Role key already exists" });
    }

    const updated = await prisma.role.update({
      where: { id },
      data: {
        ...(key ? { key } : {}),
        ...(name !== undefined ? { label: name } : {}),
      },
      include: {
        rolePermissions: { include: { permission: { select: { id: true, key: true } } } },
      },
    });
    return res.json({
      success: true,
      data: {
        id: updated.id,
        key: updated.key,
        name: updated.label,
        permissions: (updated.rolePermissions || []).map((rp) => ({ permissionId: rp.permissionId, permission: rp.permission })),
      },
    });
  } catch (e) {
    console.error("admin_roles.update error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.clone = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const source = await prisma.role.findUnique({
      where: { id },
      include: { rolePermissions: { select: { permissionId: true } } },
    });
    if (!source) return res.status(404).json({ success: false, message: "Not found" });

    const baseKey = `${source.key}_CLONE`;
    let key = baseKey;
    let n = 0;
    while (await prisma.role.findUnique({ where: { key } })) {
      n += 1;
      key = `${baseKey}_${n}`;
    }

    const created = await prisma.role.create({
      data: {
        key,
        label: `${source.label} (clone)`,
        scope: source.scope,
        isSystem: false,
      },
    });

    const permIds = (source.rolePermissions || []).map((rp) => rp.permissionId);
    if (permIds.length) {
      await prisma.rolePermission.createMany({
        data: permIds.map((permId) => ({ roleId: created.id, permissionId: permId })),
      });
    }

    const full = await prisma.role.findUnique({
      where: { id: created.id },
      include: {
        rolePermissions: { include: { permission: { select: { id: true, key: true } } } },
      },
    });
    return res.status(201).json({
      success: true,
      data: {
        id: full.id,
        key: full.key,
        name: full.label,
        permissions: (full.rolePermissions || []).map((rp) => ({ permissionId: rp.permissionId, permission: rp.permission })),
      },
    });
  } catch (e) {
    console.error("admin_roles.clone error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.replacePermissions = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const keys = Array.isArray(req.body?.keys) ? req.body.keys.map((k) => String(k).trim()).filter(Boolean) : [];
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const role = await prisma.role.findUnique({ where: { id } });
    if (!role) return res.status(404).json({ success: false, message: "Not found" });
    if (role.isSystem) return res.status(403).json({ success: false, message: "System role permissions cannot be changed" });

    const perms = await prisma.permission.findMany({
      where: { key: { in: keys } },
      select: { id: true, key: true },
    });
    const permIds = perms.map((p) => p.id);

    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: id } }),
      ...permIds.map((permId) =>
        prisma.rolePermission.create({ data: { roleId: id, permissionId: permId } })
      ),
    ]);

    const updated = await prisma.role.findUnique({
      where: { id },
      include: {
        rolePermissions: { include: { permission: { select: { id: true, key: true } } } },
      },
    });
    return res.json({
      success: true,
      data: {
        id: updated.id,
        key: updated.key,
        name: updated.label,
        permissions: (updated.rolePermissions || []).map((rp) => ({ permissionId: rp.permissionId, permission: rp.permission })),
      },
    });
  } catch (e) {
    console.error("admin_roles.replacePermissions error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

export {};
