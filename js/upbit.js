'use strict';

//  ---------------------------------------------------------------------------

const Exchange = require ('./base/Exchange');
const { ExchangeError } = require ('./base/errors');
const sign = require('jsonwebtoken').sign;

//  ---------------------------------------------------------------------------

module.exports = class upbit extends Exchange {
    describe () {
        return this.deepExtend (super.describe (), {
            'id': 'upbit',
            'name': 'Upbit',
            'countries': [ 'KR' ], // South Korea
            'rateLimit': 500,
            'has': {
                'CORS': true,
                'fetchTickers': true,
                'withdraw': true,
                'fetchMyTrades': true,
                'fetchBalance': true,
            },
            'urls': {
                'logo': 'https://user-images.githubusercontent.com/1294454/30597177-ea800172-9d5e-11e7-804c-b9d4fa9b56b0.jpg',
                'api': {
                    'public': 'https://api.upbit.com/v1',
                    'private': 'https://api.upbit.com/v1',
                },
                'www': 'https://www.upbit.com',
                'doc': 'https://docs.upbit.com/v1.0/reference',
            },
            'api': {
                'public': {
                    'get': [
                        'orderbook',
                    ],
                },
                'private': {
                    'get': [
                      'accounts',
                      'orders',
                    ],
                    'post': [
                      'orders',
                    ],
                    'delete': [
                      'order',
                    ],
                },
            },
            'fees': {
                'trading': {
                    'maker': 0.15 / 100,
                    'taker': 0.15 / 100,
                },
            },
            'exceptions': {
                '5100': ExchangeError, // {"status":"5100","message":"After May 23th, recent_transactions is no longer, hence users will not be able to connect to recent_transactions"}
            },
        });
    }

    async fetchOrderBook (symbol, limit = undefined, params = {}) {
        let request = {
            'markets': this.normalizeSymbol(symbol)
        };
        let response = await this.publicGetOrderbook (this.extend (request, params));
        let orderbook = response[0];
        let timestamp = parseInt (orderbook['timestamp']);
        let result = {
          'bids': [],
          'asks': [],
          'timestamp': timestamp,
        };

        for (let i = 0; i < orderbook['orderbook_units'].length; i++) {
          let order = orderbook['orderbook_units'][i];
          let bid = [order['bid_price'], order['bid_size']];
          result['bids'].push(bid);
          let ask = [order['ask_price'], order['ask_size']];
          result['asks'].push(ask);
        }

        return result;
    }

    async fetchBalance (params = {}) {
      let response = await this.privateGetAccounts (params)
      const free = {}
      for (const coin of response) {
        free[coin.currency] = parseFloat(coin.balance)
      }
      return { free }
    }

    async fetchMyTrades (symbol = undefined, since = undefined, limit = undefined, params = {}) {
      if (typeof symbol === 'undefined')
          throw new ExchangeError (this.id + ' fetchMyTrades requires a symbol argument');
      let request = {
        market: this.normalizeSymbol(symbol),
        state: 'done',
      }
      let response = await this.privateGetOrders (this.extend (request, params));
      return response
    }

    async createOrder (symbol, type, side, amount, price = undefined, params = {}) {
      if (side === 'buy') {
        side = 'ask'
      } else if (side === 'sell') {
        side = 'bid'
      }

      let request = undefined
      if (type === 'limit') {
        request = {
          market: this.normalizeSymbol(symbol),
          side: side,
          volume: amount,
          price: price,
          ord_type: 'limit',
        }
      } else {
        throw new ExchangeError('Order type not supported.')
      }

      let response = await this.privatePostOrders(this.extend (request, params));
      return response
    }

    async cancelOrder(id, symbol = undefined, params = {}) {
      return await this.privateDeleteOrder({ uuid: id })
    }

    nonce () {
        return this.milliseconds ();
    }

    sign (path, api = 'public', method = 'GET', params = {}, headers = undefined, body = undefined) {
        let endpoint = '/' + this.implodeParams (path, params);
        let url = this.urls['api'][api] + endpoint;
        let query = this.omit (params, this.extractParams (path));
        if (api === 'public') {
            if (Object.keys (query).length)
                url += '?' + this.urlencode (query);
        } else {
            this.checkRequiredCredentials ();
            body = this.urlencode (this.extend({}, query))
            let nonce = this.nonce ().toString ();
            const payload = {
              access_key: this.apiKey,
              nonce,
            }

            if (params !== {} && method !== 'GET') {
              payload.query = body
            }

            const token = sign(payload, this.secret)
            headers = {
                'Accept': 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Bearer ${token}`
            };
        }
        return { 'url': url, 'method': method, 'body': body, 'headers': headers };
    }

    handleErrors (httpCode, reason, url, method, headers, body) {
        if (typeof body !== 'string')
            return; // fallback to default error handler
        if (body.length < 2)
            return; // fallback to default error handler
        if ((body[0] === '{') || (body[0] === '[')) {
            let response = JSON.parse (body);
            if ('status' in response) {
                //
                //     {"status":"5100","message":"After May 23th, recent_transactions is no longer, hence users will not be able to connect to recent_transactions"}
                //
                let status = this.safeString (response, 'status');
                if (typeof status !== 'undefined') {
                    if (status === '0000')
                        return; // no error
                    const feedback = this.id + ' ' + this.json (response);
                    const exceptions = this.exceptions;
                    if (status in exceptions) {
                        throw new exceptions[status] (feedback);
                    } else {
                        throw new ExchangeError (feedback);
                    }
                }
            }
        }
    }

    async request (path, api = 'public', method = 'GET', params = {}, headers = undefined, body = undefined) {
        let response = await this.fetch2 (path, api, method, params, headers, body);
        if ('status' in response) {
            if (response['status'] === '0000')
                return response;
            throw new ExchangeError (this.id + ' ' + this.json (response));
        }
        return response;
    }

    normalizeSymbol(symbol) {
      // BTC/KRW -> KRW-BTC
      let symbols = symbol.split('/');
      return symbols[1] + '-' + symbols[0]
    }
};
