'use strict';

//  ---------------------------------------------------------------------------

const Exchange = require ('./base/Exchange');
const { ExchangeError } = require ('./base/errors');

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
                    'post': [
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
        // KRW/BTC -> KRW-BTC
        let request = {
            'markets': 'KRW-BTC',
        };
        let response = await this.publicGetOrderbook (this.extend (request, params));
        let orderbook = response['data'];
        console.log(orderbook)
        let timestamp = parseInt (orderbook['timestamp']);
        return this.parseOrderBook (orderbook, timestamp, 'bids', 'asks', 'price', 'quantity');
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
            body = this.urlencode (this.extend ({
                'endpoint': endpoint,
            }, query));
            let nonce = this.nonce ().toString ();
            let auth = endpoint + '\0' + body + '\0' + nonce;
            let signature = this.hmac (this.encode (auth), this.encode (this.secret), 'sha512');
            let signature64 = this.decode (this.stringToBase64 (this.encode (signature)));
            headers = {
                'Accept': 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Api-Key': this.apiKey,
                'Api-Sign': signature64.toString (),
                'Api-Nonce': nonce,
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
};
