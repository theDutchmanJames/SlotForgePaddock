'use strict';
// Approval protects collection-changing operations, not everyday editing.
const reviewed=new Set(['car.duplicate','car.delete','car.bulk','build.create','setup.save','setup.apply','catalogue.apply','part.deleteMany']);
function requiresReview(action,payload={}){return action==='car.save'?!payload.id:reviewed.has(action);}
module.exports={requiresReview};
