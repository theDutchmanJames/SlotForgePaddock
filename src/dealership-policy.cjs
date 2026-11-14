'use strict';
// Approval protects collection-changing operations, not everyday editing.
const reviewed=new Set(['car.purchase','car.duplicate','car.delete','car.bulk','build.create','setup.save','setup.apply','catalogue.apply','catalogue.picture','part.deleteMany']);
function requiresReview(action,payload={}){return action==='car.save'?!payload.id&&!require('./car-membership.cjs').isWishlist(payload.data):reviewed.has(action);}
module.exports={requiresReview};
