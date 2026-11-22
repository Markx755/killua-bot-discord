'use strict';
// รวมข้อความทุกระบบเป็นตารางเดียว: TXT.th / TXT.en
const parts = [
  require('./common'),
  require('./announce'),
  require('./antinuke'),
  require('./create'),
  require('./images'),
  require('./language'),
  require('./onboarding'),
  require('./tools'),
  require('./trap'),
  require('./ui'),
  require('./verify'),
];

module.exports = {
  th: Object.assign({}, ...parts.map((p) => p.th)),
  en: Object.assign({}, ...parts.map((p) => p.en)),
};
