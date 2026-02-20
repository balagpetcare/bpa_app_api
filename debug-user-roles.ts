
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('--- Debugging User Country Roles ---');

  const userCountryRoles = await prisma.userCountryRole.findMany({
    include: {
      user: true,
      role: {
        include: {
          rolePermissions: {
            include: {
              permission: true
            }
          }
        }
      },
      country: true
    }
  });

  if (userCountryRoles.length === 0) {
    console.log('No users found with country roles.');
  } else {
    for (const ucr of userCountryRoles) {
      console.log(`User: ${ucr.user.email} (ID: ${ucr.userId})`);
      console.log(`  Country: ${ucr.country.code}`);
      console.log(`  Role: ${ucr.role.key} (${ucr.role.label})`);
      const perms = ucr.role.rolePermissions.map(rp => rp.permission.key);
      console.log(`  Permissions: ${perms.join(', ')}`);
      
      if (perms.includes('country.staff.read')) {
        console.log('  [PASS] Has country.staff.read permission');
      } else {
        console.log('  [FAIL] Missing country.staff.read permission');
      }
      console.log('---');
    }
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
