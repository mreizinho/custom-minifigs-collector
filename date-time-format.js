const DATE_FORMAT_KEY='minifig-date-format';
const TIME_FORMAT_KEY='minifig-time-hour12';
const dateFormat=()=>localStorage.getItem(DATE_FORMAT_KEY)||'D MMM YYYY';
const hour12=()=>{const stored=localStorage.getItem(TIME_FORMAT_KEY)??localStorage.getItem('releaseCalendarHour12');return stored===null?new Intl.DateTimeFormat(undefined,{hour:'numeric'}).resolvedOptions().hour12:stored==='true'};
const month=date=>new Intl.DateTimeFormat(undefined,{month:'short'}).format(date).replace('.','').toUpperCase();
const formatDate=date=>{const d=date.getDate(),dd=String(d).padStart(2,'0'),m=date.getMonth()+1,mm=String(m).padStart(2,'0'),yyyy=date.getFullYear();switch(dateFormat()){case'DD/MM/YYYY':return`${dd}/${mm}/${yyyy}`;case'MM/DD/YYYY':return`${mm}/${dd}/${yyyy}`;case'YYYY-MM-DD':return`${yyyy}-${mm}-${dd}`;default:return`${d} ${month(date)} ${yyyy}`}};
const formatTime=date=>new Intl.DateTimeFormat(undefined,{hour:'2-digit',minute:'2-digit',hour12:hour12()}).format(date);
window.collectorDateTime={dateFormat,hour12,month,formatDate,formatTime};

const displayPanel=document.querySelector('[data-settings-panel="display"]');
if(displayPanel){
  const section=document.createElement('section');section.className='date-time-format-setting';section.innerHTML='<div class="date-time-mobile-headings" aria-hidden="true"><strong>Date format</strong><strong>Time format</strong></div><div class="date-time-format-controls"><label><span class="desktop-format-title">Date format</span><select aria-label="Date format" data-date-format><option>D MMM YYYY</option><option>DD/MM/YYYY</option><option>MM/DD/YYYY</option><option>YYYY-MM-DD</option></select></label><label><span class="desktop-format-title">Time format</span><select aria-label="Time format" data-time-format><option value="false">24-hour</option><option value="true">12-hour</option></select></label></div><p>Used consistently throughout the calendar and date/time fields.</p>';displayPanel.prepend(section);
  const currency=displayPanel.querySelector('.display-currency-setting'),desktopGrid=displayPanel.querySelector('.desktop-columns-setting');if(currency&&desktopGrid)desktopGrid.before(currency);
  const dateSelect=section.querySelector('[data-date-format]'),timeSelect=section.querySelector('[data-time-format]'),apply=document.querySelector('#applySettings');let baselineDate=dateFormat(),baselineTime=String(hour12()),pending=false;
  const sync=()=>{baselineDate=dateFormat();baselineTime=String(hour12());dateSelect.value=baselineDate;timeSelect.value=baselineTime;pending=false};
  const stage=()=>{pending=dateSelect.value!==baselineDate||timeSelect.value!==baselineTime;if(pending&&apply)apply.disabled=false};dateSelect.onchange=stage;timeSelect.onchange=stage;
  document.querySelector('#settingsToggle')?.addEventListener('click',()=>queueMicrotask(sync));
  if(apply){new MutationObserver(()=>{if(pending&&apply.disabled)apply.disabled=false}).observe(apply,{attributes:true,attributeFilter:['disabled']});apply.addEventListener('click',()=>{if(!pending)return;localStorage.setItem(DATE_FORMAT_KEY,dateSelect.value);localStorage.setItem(TIME_FORMAT_KEY,timeSelect.value);baselineDate=dateSelect.value;baselineTime=timeSelect.value;pending=false;window.dispatchEvent(new Event('collector-date-time-format-change'))},{capture:true})}
}

const syncPremiumPromotion=()=>{const promotion=document.querySelector('.premium-upgrade-setting');if(promotion)promotion.hidden=Boolean(window.collectorPremiumUser)};
window.addEventListener('collector-google-auth',syncPremiumPromotion);
new MutationObserver(syncPremiumPromotion).observe(document.body,{childList:true,subtree:true});
syncPremiumPromotion();

const spreadsheetSection=document.querySelector('#spreadsheetUrl')?.closest('section');
const spreadsheetInput=document.querySelector('#spreadsheetUrl');
const spreadsheetPicker=document.querySelector('#chooseSpreadsheet');
const syncSpreadsheetValue=()=>{const authenticated=Boolean(window.collectorFirebaseAuthenticatedUser);if(spreadsheetSection)spreadsheetSection.hidden=true;if(spreadsheetInput&&(!authenticated||(typeof isDemoMode==='function'&&isDemoMode())))spreadsheetInput.value='';if(spreadsheetPicker){spreadsheetPicker.disabled=!authenticated;spreadsheetPicker.title='Open Spreadsheet';spreadsheetPicker.setAttribute('aria-label','Open Spreadsheet')}};
window.addEventListener('collector-google-auth',syncSpreadsheetValue);
document.querySelector('#settingsToggle')?.addEventListener('click',()=>setTimeout(syncSpreadsheetValue,0));
const formatSettingsDialog=document.querySelector('#settingsDialog');if(formatSettingsDialog)new MutationObserver(()=>{if(formatSettingsDialog.open)syncSpreadsheetValue()}).observe(formatSettingsDialog,{attributes:true,attributeFilter:['open']});
syncSpreadsheetValue();
