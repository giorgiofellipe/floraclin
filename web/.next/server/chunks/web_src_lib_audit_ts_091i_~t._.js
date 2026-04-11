module.exports=[370421,e=>{"use strict";var t=e.i(69217),n=e.i(552692);async function s(e,s){let i=s??t.db;await i.insert(n.auditLogs).values({tenantId:e.tenantId,userId:e.userId,action:e.action,entityType:e.entityType,entityId:e.entityId,changes:e.changes,ipAddress:e.ipAddress,userAgent:e.userAgent})}e.s(["createAuditLog",0,s])}];

//# sourceMappingURL=web_src_lib_audit_ts_091i_~t._.js.map