(function(root){
  const domain=typeof module==='object'&&module.exports?require('./domain.js'):root.slotforgeDomain;
  function summary(db,day=domain.today()){
    const incoming=db.submissions.filter(s=>s.status==='pending').flatMap(s=>s.package.cars.filter(c=>!s.outcomes[c.id]));
    const jobs=db.jobs.filter(j=>j.status==='active');
    const maintenance=domain.reminders(db.events).filter(e=>db.cars.some(c=>c.id===e.carId&&!c.archived));
    const due=maintenance.filter(e=>e.nextDue<=day),upcoming=maintenance.filter(e=>e.nextDue>day);
    return {incoming,jobs,maintenance,due,upcoming,attention:incoming.length+due.length,day};
  }
  const api={summary};if(typeof module==='object'&&module.exports)module.exports=api;else root.ReviewModel=api;
})(globalThis);
