const jwt = require("jsonwebtoken");

// With a temporary password, only these requests work until a new password is set.
const allowedWithTemporaryPassword = new Set(["GET /api/me","PATCH /api/me/password","POST /api/me/presence","POST /api/auth/logout"]);

function authFor(db) {
  return (request,response,next) => {
    const authorization=request.headers.authorization||"";
    if (!authorization.startsWith("Bearer ")) return response.status(401).json({message:"Login is required."});
    try {
      const claims=jwt.verify(authorization.slice(7),process.env.JWT_SECRET,{algorithms:["HS256"]});
      if (!Number.isSafeInteger(claims.id)) throw new Error("Invalid identity");
      const user=db.prepare("SELECT id,email,role,status,auth_version,must_change_password FROM users WHERE id=?").get(claims.id);
      if (!user || user.status!=="Active" || (claims.ver||0)!==user.auth_version) throw new Error("Session revoked");
      request.user={id:user.id,email:user.email,role:user.role};
      if (user.must_change_password && !allowedWithTemporaryPassword.has(request.method+" "+request.originalUrl.split("?")[0])) {
        return response.status(403).json({message:"Please change your temporary password first.",mustChangePassword:true});
      }
      next();
    } catch {
      response.status(401).json({message:"Your login session is invalid, inactive, or expired. Please sign in again."});
    }
  };
}
function requireRole(...roles) {
  return (request,response,next) => roles.includes(request.user?.role)
    ? next() : response.status(403).json({message:"You do not have permission for this action."});
}
module.exports={authFor,requireRole};
