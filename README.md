# stonyx-backend-application
Main base vanilla application / host module
The intention is that this application can be used as a "base" for the Stonyx framework

## Running the application
```
node . 
```

## Color Coded Logging via Chronicle

```js
import log from 'stonyx/log';
```

Stonyx utilizes our own chronicle library for logging: https://github.com/abofs/chronicle.
For all Stonyx modules, color coding can be dynamically configured by providing a `logColor` setting in the `environent.js` file.

### Example:

```js
// environment.js
//...
db: {
  logColor: 'white',
  //...
}
```
The above setting will expose the `log.db()` method, which will output in white.
Alternatively you can provide a `logMethod` setting if you would rather use a different alias that
does not match the class name, and `logTimestamp` as a true if you wish your log to include timestamp.
`stonyx/log` fully exposes the `chronicle` object. See Chronicle documentation for more information.

```js
// environment.js
//...
restServer: {
  logColor: 'yellow',
  logMethod: 'api'
  //...
}
```

The above example will expose `log.api()`, which will output in yellow.

## Module Development

`modules.js` is responsible for dynamically loading any async stonyx modules.
Conventionally, all official Stonyx modules must be prefixed with `@stonyx/`, and
contain the `stonyx-module` keyword in its respective `package.json` file.

Async modules require the `stonyx-async` keyword in order to be automatically loaded.

## License

Apache — do what you want, just keep attribution.
