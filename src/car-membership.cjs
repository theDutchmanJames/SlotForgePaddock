'use strict';
// Collection membership is independent of user-defined labels and ownership text.
// Missing membership is the backwards-compatible value for existing cars.
const status=car=>car?.collectionStatus??'collection';
const isWishlist=car=>status(car)==='wishlist';
const active=car=>!!car&&!car.archived&&!isWishlist(car);
function validate(value){if(!['collection','wishlist'].includes(value))throw Error('Invalid car collection status.');return value;}
function unchanged(car,input){if(Object.hasOwn(input,'collectionStatus')&&validate(input.collectionStatus)!==status(car))throw Error('Collection membership cannot be changed through ordinary car edits.');}
function physical(car){if(isWishlist(car))throw Object.assign(Error('Mark this Wishlist car as purchased before using physical car or racing actions.'),{code:'CAR_WISHLIST',apiCode:'CAR_WISHLIST',httpStatus:409});}
module.exports={status,isWishlist,active,validate,unchanged,physical};
