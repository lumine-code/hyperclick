const Config = {
  get(key) {
    return lumine.config.get(`hyperclick.${key}`);
  },

  set(key, value) {
    return lumine.config.set(`hyperclick.${key}`, value);
  },

  observe(key, callback) {
    return lumine.config.observe(`hyperclick.${key}`, callback);
  },
};

module.exports = Config;
