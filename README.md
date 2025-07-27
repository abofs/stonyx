# stonyx-backend-application
Main base vanilla application / host module
The intention is that this application can be used as a "base" for the Stonyx framework

## Running the application
```
node . 
```

## Running the test suite
```
npm test
```

## Resource Handler

TODO: Update documentation to instruct a broader audience

The Resource Handler class wraps the `path` and `fs` library to allow consuming classes to manipulate the local file system with full async/await support. Additionally it exposes the `forEachFileImport` method which lets us dynamically and flexibly import dependencies.

### Usage example

```js
  await forEachFileImport(targetDirectory, (exports, details) => {
    // Insert logic per export
  }, options);
```

### Valid Options

| Option | Type | Default | Description |
| :---: | :---: | :---: | :--- |
| `fullExport` | **Boolean** | *false* | When set to true, The `exports` parameter will be all exports, and not just the default one. |
| `rawName` | **Boolean** | *false* | When set to true, `forEachFileImport` will not convert the file name to be camelCase and leave it raw instead |

# Third Party Services

`services.js` creates a reusable singleton service for third-party utils. The intention is to allow external modules
to be re-used and accessed across the application without needing to re-wrap them. 

## Color Coded Logging via Chronicle

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