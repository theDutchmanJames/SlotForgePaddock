function ratioRows(technical={}){const ratio=slotforgeDomain.gearRatioText(technical.pinion,technical.gear);return ratio?[['Gear ratio',ratio]]:[];}
function ratioEditor(prefix,technical={}){return `<div class="field gear-ratio"><span>Gear ratio · driven gear ÷ pinion</span><output data-gear-ratio="${prefix}" aria-live="polite">${slotforgeDomain.gearRatioText(technical.pinion,technical.gear)||'Enter positive whole tooth counts'}</output><small class="muted">Calculated automatically; rounded to three decimals.</small></div>`;}
document.addEventListener('input',event=>{
  const match=event.target.name?.match(/^(technical|factory)\.(pinion|gear)$/);if(!match)return;
  const form=event.target.form,prefix=match[1],output=form?.querySelector(`[data-gear-ratio="${prefix}"]`);if(!output)return;
  output.textContent=slotforgeDomain.gearRatioText(form.elements.namedItem(prefix+'.pinion').value,form.elements.namedItem(prefix+'.gear').value)||'Enter positive whole tooth counts';
});
