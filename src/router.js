// Express 4 não encaminha rejeições de handlers async automaticamente.
const express = require('express');

module.exports = function criarRouter() {
  const router = express.Router();
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    const register = router[method].bind(router);
    router[method] = (path, ...handlers) => register(path, ...handlers.map((handler) =>
      (req, res, next) => Promise.resolve().then(() => handler(req, res, next)).catch(next)
    ));
  }
  return router;
};
