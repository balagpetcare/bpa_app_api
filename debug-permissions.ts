
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('--- Roles & Permissions ---');
  const roles = await prisma.role.findMany({
    include: {
      rolePermissions: {
        include: {
          permission: true
        }
      }
    }
  });
  for (const role of roles) {
    console.log(`Role: ${role.key} (ID: ${role.id}, Scope: ${role.scope})`);
    // @ts-ignore
    const perms = role.rolePermissions.map((rp) => rp.permission.key);
    console.log(`  Permissions: ${perms.join(', ')}`);
    if (perms.includes('country.staff.read')) {
      console.log('  ✅ Has country.staff.read');
    } else {
      console.log('  ❌ MISSING country.staff.read');
    }
  }
  console.log('\n--- User Country Roles ---');
  const userRoles = await prisma.userCountryRole.findMany({
    include: {
      user: true,
      role: true,
      country: true
    }
  });

  for (const ur of userRoles) {
    console.log(`User: ${ur.user.email} (ID: ${ur.userId})`);
    console.log(`  Country: ${ur.country.code}`);
    console.log(`  Role: ${ur.role.key}`);
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
