var Constants = require('Constants');
var Sensor = require('sim/sensors/Sensor');
var Camera = require('gfx/Camera');
var _ = require('util/util');

/**
 * Camera based sensor (used for color/depth/objects) view renderings.  Default is RGB color renderings.
 * @param config Sensor configuration
 * @param config.name {string} sensor name
 * @param config.position {THREE.Vector3} sensor position
 * @param config.orientation {THREE.Vector3} sensor orientation
 * @param config.width {int} width of camera sensor resolution
 * @param config.height {int} height of camera sensor resolution
 * @param config.encoding {string} output encoding of sensor
 * @param [config.fov=45] {number} Vertical field of view (in degrees)
 * @param opts Additional options
 * @param opts.getRenderer {function({config, opts): gfx.Renderer}
 * @constructor
 * @memberOf sim.sensors
 */
function CameraSensor(config, opts) {
  Sensor.call(this, config);
  this.showDebugNode = !!opts.showDebugNode;  // Coerce into boolean
  var cameraConfig = _.defaults(Object.create(null), config, {
    fov: 45,
    near: 0.001, // default near in meters
    far: 20      // default far in meters
  });
  cameraConfig.near = cameraConfig.near*Constants.metersToVirtualUnit;
  cameraConfig.far = cameraConfig.far*Constants.metersToVirtualUnit;
  // NOTE: This may not be the actual width/height due to some sensors having "resize=true" or being the "main" renderer
  cameraConfig.width = cameraConfig.resolution[0];
  cameraConfig.height = cameraConfig.resolution[1];
  var rendererConfig = config;
  var cam;
  if (cameraConfig.position.length > 1) {
    cam = Camera.createArrayCamera(cameraConfig);
    rendererConfig = _.clone(config);
    rendererConfig.cameraArrayShape = cam.userData.shape;
    rendererConfig.resolution = cam.userData.imageShape;
    // HACK to remove not use main renderer for array cameras since initial size may not be correct
    // and resizing of ssc OffscreenRenderer doesn't work
    if (!Constants.isBrowser && rendererConfig.renderer === 'main') {
      delete rendererConfig.renderer;
    }
  } else {
    cam = new Camera(cameraConfig.fov, cameraConfig.width/cameraConfig.height,
      cameraConfig.near, cameraConfig.far
    );
    var camPos = cameraConfig.position[0];
    cam.position.copy(camPos);
    if (cameraConfig.orientation) {
      var target = cam.position.clone();
      target.add(cameraConfig.orientation[0]);
      cam.lookAt(target);
    }
    cam.updateMatrix();
    cam.updateProjectionMatrix();
  }
  cam.name = config.name;  // Store sensor name as camera name
  cam.isEquirectangular = cameraConfig.isEquirectangular;
  this.camera = cam;
  this.renderer = opts.getRenderer(rendererConfig, opts);
  // Weird resizing (if the sensor was resized)
  if (this.renderer.width !== rendererConfig.width || this.renderer.height !== rendererConfig.height) {
    this.setSize(this.renderer.width, this.renderer.height);
  }

  this.numFramesRendered = 0;
}

CameraSensor.prototype = Object.create(Sensor.prototype);
CameraSensor.prototype.constructor = Sensor;

CameraSensor.prototype.getFrame = function(sceneState) {
  var debugNodeVisibility;
  if (sceneState.debugNode) {
    debugNodeVisibility = sceneState.debugNode.visible;
    sceneState.debugNode.visible = this.showDebugNode;
  }
  var result = this.__getFrame(sceneState);
  this.numFramesRendered++;

  if (sceneState.debugNode) {
    sceneState.debugNode.visible = debugNodeVisibility;
  }

  return result;
};

// Override this function to have custom frames
CameraSensor.prototype.__getFrame = function(sceneState) {
  var scene = sceneState.fullScene || sceneState;
  var pixels = null;
  var numChannels = 4;
  var renderer = this.renderer;
  var encoding = this.config.encoding;
  var sceneId = scene.name;
  var camera = this.camera;

  // TODO: consider encoding
  switch (encoding) {
    case 'rgba':
      pixels = renderer.renderToRawPixels(scene, camera).buffer;
      break;
    case 'gray':
      var p = renderer.renderToRawPixels(scene, camera);
      var ngraypixels = p.length / 4;
      for (var i = 0; i < ngraypixels; i++) {
        var b = i << 2;  // 4 * i
        p[i] = 0.2126 * p[b] + 0.7152 * p[b+1] + 0.0722 * p[b+2];
      }
      pixels = p.slice(0, ngraypixels).buffer;
      numChannels = 1;
      break;
    case 'pngbuf':
      pixels = renderer.renderToBuffer(scene, camera);
      break;
    case 'pngfile':
      var pngfile = sceneId + '_' + this.name + '.png';
      pixels = renderer.renderToPng(scene, camera, pngfile);
      break;
    case 'pngseq':
      var pngseq = sceneId + '_' + this.name + '_' + _.padStart(this.numFramesRendered, 5, '0') + '.png';
      pixels = renderer.renderToPng(scene, camera, pngseq);
      break;
    case 'screen':
      pixels = renderer.render(scene, camera);
      break;
    default:
      console.error('Invalid encoding: ' + encoding);
  }

  return {
    type: 'color',
    data: pixels,
    encoding: encoding,
    shape: [this.renderer.width, this.renderer.height, numChannels]
  };
};

CameraSensor.prototype.getShape = function() {
  return [this.renderer.width, this.renderer.height, 4];
};

CameraSensor.prototype.getDataRange = function() {
  return [0,255];
};

CameraSensor.prototype.getMetadata = function() {
  return {
    name: this.name,
    type: this.config.type,
    shape: this.getShape(),
    dataType: this.config.datatype || 'uint8',
    dataRange: this.getDataRange()
  };
};

CameraSensor.prototype.setSize = function(width, height) {
  console.log('resize sensor ' + this.name + ' to ' + width + 'x' + height);
  this.camera.aspect = width / height;
  this.camera.updateProjectionMatrix();
  if (this.camera.isArrayCamera) {
    this.camera.resizeCameras(width, height);
  }
  if (this.renderer.width !== width || this.renderer.height !== height) {
    this.renderer.setSize(width, height);
  }
};

CameraSensor.prototype.createPixelBuffer = function() {
  return new Uint8Array(4 * this.renderer.width * this.renderer.height);
};

module.exports = CameraSensor;

/**
 * Frame of 2D data from a camera sensor
 * @typedef sim.sensors.CameraSensor.Frame
 * @type {object}
 * @property type {string} Sensor type
 * @property data {Array|TypedArray} pixels from the camera sensor (can be color, depth, semantic mask)
 * @property encoding {string} Encoding indicating how the data should be interpreted
 * @property shape {Array} Array indicating the width, height, and number of channels of the data
 */
