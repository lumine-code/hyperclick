const Config = {
  get(key) {
    return atom.config.get(`hyperclick.${key}`);
  },

  set(key, value) {
    return atom.config.set(`hyperclick.${key}`, value);
  },

  observe(key, callback) {
    return atom.config.observe(`hyperclick.${key}`, callback);
  },
};

module.exports = Config;
