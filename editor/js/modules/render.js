/*  
	This module is in charge or rendering the Scene.
	The module initializes the CanvasManager that handles the Web3D canvas and the interaction.
*/

var RenderModule = {

	name: "Scene",
	bigicon: "imgs/tabicon-scene.png",
	enabled: true,
	//settings_panel: [{name:"renderer", title:"Renderer", icon:null }],

	auto_render: false, //force render a frame every time
	frame_updated: false,
	render_mode: "full",
	shaders_url: "../litescene/data/shaders.xml",

	render_settings: new LS.RenderSettings(),
	cameras: [], //viewports
	selected_camera: null, //last viewport clicked by the mouse
	under_camera: null, //camera below the mouse

	commands:{},

	preview_camera: null,
	temp_camera: null, //used to clone preview camera
	show_stencil_mask: -1,

	init: function()
	{
		//create 3D tab
		this.tab = LiteGUI.main_tabs.addTab( this.name, {
				id:"visortab", 
				bigicon: this.bigicon,
				size: "full",
				module: EditorModule,
				callback: function() {
					if(!RenderModule.canvas_manager)
						return;

					RenderModule.render_settings.in_player = false;
					InterfaceModule.setSidePanelVisibility(true);

					if(window.gl && window.gl.canvas)
					{
						RenderModule.canvas_manager.resize(); //adapt to parent size
						RenderModule.requestFrame();
					}
					EditorModule.refreshAttributes(); //why not? it was commented
				}
		});

		this.tab.content.style.overflow = "hidden";

		//create split
		var visorarea = this.visorarea = new LiteGUI.Area("visorarea",{ height: "100%", autoresize: true, inmediateResize: true});
		visorarea.split("vertical",[null,260], true);
		visorarea.getSection(0).content.innerHTML = "<div id='visor'><div id='maincanvas'></div><div id='statusbar'><span class='msg'></div></div></div>";
		this.tab.add( visorarea );

		if( !InterfaceModule.preferences.show_low_panel )
			visorarea.hideSection(1); //DEFAULT SHOW TIMELINE ***********************************
		var visor_container = this.visor_container = document.getElementById("visor");
		var canvas_container = this.canvas_container = document.getElementById("maincanvas");
		InterfaceModule.setVisorArea( visorarea );

		//The WebGLContext is created from CanvasManager !!!!!!!

		//create canvas and store inside the #visor
		this.canvas_manager = new CanvasManager( { container: canvas_container, full: true, antialiasing: true} );
		if(!this.canvas_manager.gl)
		{
			this.onWebGLNotEnabled();
			return;
		}
		this.canvas_manager.addWidget(this); //capture render, update and mouse

		//CANVAS
		var canvas = this.canvas_manager.canvas;
		this.shaders_url = CORE.config.shaders || this.shaders_url;
		LS.ShadersManager.init( this.shaders_url ); //load shaders
		LS.Renderer.init();
		LS.Input.init();
		LS.catch_errors = false; //helps coding

		this.render_settings.render_all_cameras = false;
		this.render_settings.in_player = false;
		this.render_settings.keep_viewport = true;

		//LiteGUI.bind( window, "resize", function() {  RenderModule.requestFrame(); }); //dont work
		$(window).resize( function() {  RenderModule.requestFrame(); });

		LiteGUI.bind( LiteGUI, "resized",function(){
			canvas.width = canvas.parentNode.offsetHeight;
			canvas.height = canvas.parentNode.offsetWidth;
			RenderModule.requestFrame();
		});

		document.addEventListener("fullscreenchange", this.onChangeFullscreen );
		document.addEventListener("mozfullscreenchange", this.onChangeFullscreen );
		document.addEventListener("webkitfullscreenchange", this.onChangeFullscreen );

		LEvent.bind( LS.GlobalScene, "serialize", this.onSerialize.bind(this) );
		LEvent.bind( LS.GlobalScene, "configure", this.onConfigure.bind(this) );


		//init GUI *************************************

		this.setViewportLayout(1);

		//LS.GlobalScene.init();
		LEvent.bind( LS.GlobalScene, "change", function() { LS.GlobalScene.refresh(); }); //refresh image when something changes

		LEvent.bind( LS.ResourcesManager, "resource_loaded", function(e ) { 
			RenderModule.requestFrame();
		});

		//init GUI
		LiteGUI.menubar.add("View/Autorender", { type: "checkbox", instance:RenderModule, property:"auto_render" });
		LiteGUI.menubar.add("View/Fullscreen", { callback: function() { RenderModule.goFullscreen(); }});
		LiteGUI.menubar.separator("View");
		LiteGUI.menubar.add("View/Camera/Orthographic", { callback: function() { RenderModule.changeCameraType( LS.Camera.ORTHOGRAPHIC ); }});
		LiteGUI.menubar.add("View/Camera/Perspective", { callback: function() { RenderModule.changeCameraType( LS.Camera.PERSPECTIVE ); }});
		LiteGUI.menubar.add("View/Camera/Properties", { callback: function() { EditorModule.inspect( RenderModule.cameras ); }});
		LiteGUI.menubar.add("View/Camera/Smooth", { type: "checkbox", instance: cameraTool, property:"smooth_camera" });
		LiteGUI.menubar.add("View/Camera/Lock Angle", { type: "checkbox", instance: cameraTool.settings, property:"lock_angle" });


		LiteGUI.menubar.add("View/Layout/One", { callback: function(){ RenderModule.setViewportLayout(1); } });
		LiteGUI.menubar.add("View/Layout/Two Vertical", { callback: function(){ RenderModule.setViewportLayout(2); } });
		LiteGUI.menubar.add("View/Layout/Two Horitzontal", { callback: function(){ RenderModule.setViewportLayout(3); } });
		LiteGUI.menubar.add("View/Layout/Three", { callback: function(){ RenderModule.setViewportLayout(4); } });
		LiteGUI.menubar.add("View/Layout/Four", { callback: function(){ RenderModule.setViewportLayout(5); } });

		LiteGUI.menubar.separator("View");
		//LiteGUI.menubar.add("Actions/System/Relaunch", { callback: RenderModule.relaunch });

		this.registerCommands();

		RenderModule.canvas_manager.resize();
		this.temp_camera = new LS.Camera();

		LEvent.bind( LS.Renderer, "afterRenderInstances", this.onAfterRenderInstances, this);
	},

	setViewportLayout: function(mode)
	{
		var old_cameras = this.cameras;

		//in case we changed something in the cameras that we want to recover
		for(var i in old_cameras)
		{
			var camera = old_cameras[i];
			if(camera._prev_viewport)
			{
				camera._viewport.set( camera._prev_viewport );
				delete camera._prev_viewport;
			}
		}

		//clear cameras
		this.cameras = [];

		//create new ones
		if(mode == 2)
		{
			this.camera = new LS.Camera({eye:[50,100,100], center: LS.ZEROS, near:0.1,far:10000, viewport:[0,0,0.5,1]});
			this.camera2 = new LS.Camera({eye:[50,100,100],center: LS.ZEROS, near:0.1,far:10000, viewport:[0.5,0,0.5,1]});
			this.cameras.push( this.camera, this.camera2 );
		}
		else if(mode == 3)
		{
			this.camera = new LS.Camera({eye:[50,100,100],center: LS.ZEROS, near:0.1,far:10000, viewport:[0,0,1,0.5]});
			this.camera2 = new LS.Camera({eye:[50,100,100],center: LS.ZEROS, near:0.1,far:10000, viewport:[0,0.5,1,0.5]});
			this.cameras.push( this.camera, this.camera2 );
		}
		else if(mode == 4)
		{
			this.camera = new LS.Camera({eye:[50,100,100],center: LS.ZEROS, near:0.1,far:10000, viewport:[0,0,0.5,0.5]});
			this.camera2 = new LS.Camera({eye:[50,100,100],center: LS.ZEROS, near:0.1,far:10000, viewport:[0,0.5,0.5,0.5]});
			this.camera3 = new LS.Camera({eye:[50,100,100],center: LS.ZEROS, near:0.1,far:10000, viewport:[0.5,0,0.5,1]});
			this.cameras.push( this.camera, this.camera2, this.camera3 );
		}
		else if(mode == 5)
		{
			this.camera = new LS.Camera({eye:[50,100,100],center: LS.ZEROS, near:0.1,far:10000, viewport:[0,0,0.5,0.5]});
			this.camera2 = new LS.Camera({eye:[50,100,100],center: LS.ZEROS, near:0.1,far:10000, viewport:[0.5,0,0.5,0.5]});
			this.camera3 = new LS.Camera({eye:[50,100,100],center: LS.ZEROS, near:0.1,far:10000, viewport:[0,0.5,0.5,0.5]});
			this.camera4 = new LS.Camera({eye:[50,100,100],center: LS.ZEROS, near:0.1,far:10000, viewport:[0.5,0.5,0.5,0.5]});
			this.cameras.push( this.camera, this.camera2, this.camera3 , this.camera4 );
		}
		else if(mode == 16) //benchmark
		{
			for(var i = 0; i < 4; i++)
				for(var j = 0; j < 4; j++)
					this.cameras.push( this.camera = new LS.Camera({eye:[50 * Math.random(),100,100 * Math.random()],center: LS.ZEROS, near:0.1,far:10000, viewport:[0.25*i,0.25*j,0.25,0.25]}) );
		}
		else //1
		{
			this.camera = new LS.Camera({eye:[50,100,100],center: LS.ZEROS, near:0.1,far:10000, viewport:[0,0,1,1]});
			this.cameras.push( this.camera );
		}

		var bg_color = null;
		if(LS.GlobalScene.root && LS.GlobalScene.root.camera)
			bg_color = LS.GlobalScene.root.camera.background_color;

		//add to the cameras useful editor info
		for(var i = 0; i < this.cameras.length; i++)
		{
			var camera = this.cameras[i];
			if(bg_color)
				camera.background_color.set( bg_color );
			//copy from first camera
			if(old_cameras && old_cameras.length)
			{
				camera._eye.set( old_cameras[0]._eye );
				camera._center.set( old_cameras[0]._center );
				camera._up.set( old_cameras[0]._up );
			}
			camera.updateMatrices(true);
			this.processEditorCamera( camera, i );
		}

		this.selected_camera = this.cameras[0];

		this.requestFrame();
	},

	setViewportCamera: function( index, new_camera )
	{
		var old = this.cameras[ index ];
		if(!old)
		{
			console.warn("Unknown camera index");
			return;
		}

		this.cameras[ index ] = new_camera;
		this.processEditorCamera( new_camera, index );
		new_camera._viewport.set( old._viewport );

		if( old && old._prev_viewport )
		{
			old._viewport.set( old._prev_viewport );
			delete old._prev_viewport;
		}
	},

	//it prepares a camera to be used in the editor
	processEditorCamera: function( camera, index )
	{
		if( camera._root ) //is a scene camera
			camera._prev_viewport = new Float32Array( camera._viewport );
		else //is an editor camera
			camera.uid = LS.generateUId("CAM");

		camera._editor = { 
			index: index,
			name: "perspective",
			corner: "bottom-right",
			destination_eye: vec3.clone( camera.eye ),
			destination_center: vec3.clone( camera.center ),
			render_settings: null,
			flags: {},
		};

		//add gizmos
		camera._gizmos = [ new CameraGizmo( camera ) ];
	},

	relaunch: function() { 
		console.log("Relaunching...");
		RenderModule.canvas_manager.gl.relaunch(); 
	},

	appendViewportTo: function(parent)
	{
		var canvas = this.canvas_manager.canvas;
		if(!canvas)
			return;

		if(parent)
			parent.appendChild(canvas);
		else
			document.getElementById("maincanvas").appendChild(canvas);
		RenderModule.canvas_manager.resize();
		RenderModule.requestFrame();
		return canvas;
	},

	getCanvas: function()
	{
		return this.canvas_manager.canvas;
	},

	//called by the CanvasManager on requestAnimationFrame
	render: function(context, force_render)
	{
		if(context === true) //allows to pass the second parameter as first
		{
			context = gl;
			force_render = true;
		}

		this.frame_updated = false;

		if(!force_render)
		{
			//if 3d not visible
			if(!this.enabled) 
				return;
			if( !this.auto_render && !LS.GlobalScene._must_redraw )
				return;
		}

		this.frame_updated = true;
		this.canvas_manager.frame_rendered = true;

		var global_render_settings = this.render_settings;
		var scene_render_settings = LS.GlobalScene.info ? LS.GlobalScene.info.render_settings : global_render_settings;
		render_settings = global_render_settings.in_player ? scene_render_settings : global_render_settings;


		//gl.viewport(0,0,500,500); //test

		//check if render one single camera or multiple cameras
		var cameras = null;
		if(!global_render_settings.in_player)
		{
			cameras = this.cameras.concat(); //clone
			//search for render to texture cameras, puts them at the beginning
			var scene_cams = LS.GlobalScene._cameras;
			for(var i in scene_cams)
			{
				var cam = scene_cams[i];
				if(cam.isRenderedToTexture())
					cameras.unshift(cam); //add this camera to the list of cameras we are going to use to render
			}
			render_settings.main_camera = this.selected_camera;
		}

		//theoretically this is not necessary, but just in case
		gl.viewport(0,0,gl.canvas.width, gl.canvas.height);

		LEvent.trigger(this,"pre_scene_render");
		gl.clear( gl.DEPTH_BUFFER_BIT ); //�?

		//render frame
		if( this.special_pass ) 
			this.renderSpecialPass( this.special_pass ); //used for debug mostly
		else
		{
			LS.Renderer.resetState(); //in case some error stopped the rendering inm the previous frame
			LS.Renderer.render( LS.GlobalScene, render_settings, cameras );
		}
		LEvent.trigger(this,"post_scene_render");
	},

	onAfterRenderInstances: function()
	{
		if(this.show_stencil_mask > -1)
		{
			gl.disable( gl.DEPTH_TEST );
			LS.Renderer._black_texture.toViewport();
			gl.enable( gl.STENCIL_TEST );
			gl.stencilFunc( GL.EQUAL, this.show_stencil_mask, 0xFF );
			LS.Renderer._white_texture.toViewport();
			gl.disable( gl.STENCIL_TEST );
		}
		else if(this.show_depth_buffer ) //superhack
		{
			if(!this._depth_shader)
				this._depth_shader = new GL.Shader( this._depth_vertex_shader_code, this._depth_fragment_shader_code );
			var mesh = GL.Mesh.getScreenQuad();

			var camera = LS.Renderer._current_camera;
			var N = camera.near;
			var F = camera.far;
			gl.enable( gl.DEPTH_TEST );
			gl.depthMask( false );
			gl.depthFunc( gl.LESS );
			gl.disable( gl.CULL_FACE );
			gl.disable( gl.BLEND );
			var slices = 128;
			for(var i = 0; i <= slices; ++i)
			{
				var linear_f = i/slices;
				//linear_f = (2.0 * N) / (F + N - D * (F - N));
				var depth = Math.pow(linear_f,0.01);
				this._depth_shader.uniforms({u_color: linear_f, u_depth: depth}).draw(mesh);
			}
			gl.depthMask( true );
			gl.depthFunc( gl.LESS );
		}
	},

	//used for debug, allows to render shadows or picking buffers directly to screen
	renderSpecialPass: function( pass )
	{
		if( pass == "picking" )
		{
			LS.Picking.renderPickingBuffer( LS.GlobalScene, this.cameras[0] );
		}
		else
		{
			LS.Renderer.setRenderPass( pass );
			LS.Renderer.renderInstances( new LS.RenderSettings() );
		}
	},

	//used to select viewport
	mousedown: function(e)
	{
		var camera = this.getCameraUnderMouse(e);
		if(!camera || camera == this.selected_camera )
			return;
		this.selected_camera = camera;
	},

	//used to change the camera below the mouse
	mousemove: function(e)
	{
		var camera = this.getCameraUnderMouse(e);
		if(!camera || camera == this.under_camera )
			return;
		this.under_camera = camera;
	},

	getActiveCamera: function()
	{
		return this.under_camera;
	},

	getCameraUnderMouse: function(e)
	{
		var cameras = this.cameras;
		var viewport = vec4.create();
		for(var i = cameras.length-1; i >= 0; --i)
		{
			var camera = cameras[i];
			if( camera.isPointInCamera( e.canvasx, e.canvasy ) )
				return camera;
		}
		return null;
	},

	setRenderMode: function(v)
	{
		this.render_mode = v;

		this.render_settings.force_shader = null;
		this.render_settings.force_wireframe = false;
		this.render_settings.shadows_disabled = false;
		this.render_settings.lights_disabled = false;

		if(v == "wireframe")
		{
			this.render_settings.force_shader = "flat";
			this.render_settings.force_wireframe = true;
			this.render_settings.shadows_disabled = true;
			this.render_settings.lights_disabled = true;
		}
		else if(v == "flat")
		{
			this.render_settings.force_shader = "flat";
			this.render_settings.shadows_disabled = true;
			this.render_settings.lights_disabled = true;
		}
		else if(v == "solid")
		{
			this.render_settings.force_shader = "phong";
			this.render_settings.shadows_disabled = true;
		}
		else if(v == "texture")
		{
			this.render_settings.force_shader = "flat_texture";
			this.render_settings.shadows_disabled = true;
			this.render_settings.lights_disabled = true;
		}

		this.requestFrame();
	},

	changeCameraType: function(type)
	{
		var camera = this.selected_camera || this.camera;
		camera.type = type;
		this.requestFrame();
	},

	requestFrame: function()
	{
		LS.GlobalScene.refresh();
	},

	setAutoSelect: function(v)
	{
		cameraTool.auto_select = v;
	},

	setCameraMode: function(mode)
	{
		cameraTool.mode = mode;
	},

	onSerialize: function(e, o)
	{
		if(!o.extra)
			o.extra = {};

		var viewport_layout = o.extra.viewport_layout = {
			cameras: []	
		};

		//save cameras
		for(var i in this.cameras)
		{
			var camera = this.cameras[i];
			viewport_layout.cameras.push( camera.serialize() );
		}
	},

	onConfigure: function(e, o)
	{
		if(!o.extra || !o.extra.viewport_layout)
			return;

		//Restore cameras
		var viewport_layout = o.extra.viewport_layout;
		if(viewport_layout.cameras)
		{
			RenderModule.setViewportLayout( viewport_layout.cameras.length );
			for(var i in viewport_layout.cameras)
			{
				var cam_info = viewport_layout.cameras[i];
				RenderModule.cameras[i].configure(cam_info);
			}
		}
	},

	//returns string or blob
	takeScreenshot: function( width, height, on_complete )
	{
		width = width || 256;
		height = height || 256;
		var v3d = RenderModule.canvas_manager;

		if( v3d.canvas.width > width ) //render big and downscale
		{
			this.render(true); //change render_settings?
			var canvas = createCanvas( width, height );
			//document.body.appendChild(canvas);
			var ctx = canvas.getContext("2d");
			var scalew = width / v3d.canvas.width;
			var scaleh = height / v3d.canvas.height;
			var scale = Math.max( scalew, scaleh ); //the biggest so it fits all
			if(scale == scaleh )
				ctx.translate( ((scale * v3d.canvas.width) - width) * -0.5, 0 );
			else
				ctx.translate( 0, ((scale * v3d.canvas.height) - height) * -0.5 );
			ctx.scale( scale, scale );
			ctx.drawImage( v3d.canvas, 0, 0 );
			if(on_complete)
			{
				canvas.toBlob( on_complete, "image/png");
				RenderModule.render(true); //force render a frame to clean 
				return null;
			}
			data = canvas.toDataURL("image/png");
		}
		else //render to specific size
		{
			var old = [v3d.canvas.width,v3d.canvas.height];
			v3d.resize(width,height);
			
			this.render(true);
			var data = null;
			
			if(on_complete)
			{
				v3d.canvas.toBlob( on_complete, "image/png");
				v3d.resize(old[0],old[1]);
				RenderModule.render(true); //force render a frame to clean 
				return null;
			}

			data = v3d.canvas.toDataURL("image/png");
			v3d.resize(old[0],old[1]);
			this.render(true); //force render a frame to clean 
		}
		return data;
	},

	goFullscreen: function()
	{
		var fullscreen_root = document.getElementById("maincanvas");
		//gl.fullscreen();

		if(fullscreen_root.requestFullScreen)
			fullscreen_root.requestFullScreen();
		else if(fullscreen_root.webkitRequestFullScreen)
			fullscreen_root.webkitRequestFullScreen();
		else if(fullscreen_root.mozRequestFullScreen)
			fullscreen_root.mozRequestFullScreen();
		else
			console.error("Fullscreen not supported");
	},

	onChangeFullscreen: function(e)
	{
		console.log(e);
		if(!RenderModule._old_size)
		{
			RenderModule._old_size = [gl.canvas.width, gl.canvas.height];
			gl.canvas.width = window.screen.width;
			gl.canvas.height = window.screen.height;
		}
		else
		{
			gl.canvas.width = RenderModule._old_size[0];
			gl.canvas.height = RenderModule._old_size[1];
			RenderModule._old_size = null;
		}
		LS.GlobalScene.refresh();
	},

	registerCommands: function()
	{
		this.commands["layout"] = function(cmd, tokens) { 
			EditorModule.inspect( RenderModule.cameras );
		};
	},

	getNodeAtCanvasPosition: function(x,y)
	{
		var instance_info = LS.Picking.getInstanceAtCanvasPosition( x, y, ToolUtils.getCamera() );
		if(!instance_info)
			return null;
		if( instance_info.constructor == LS.SceneNode)
			return instance_info;
		return instance_info.node;
	},

	testGridCollision: function(x,y)
	{
		if(x === undefined || y === undefined)
			throw("testGridCollision: params missing");
		var camera = ToolUtils.getCamera();
		var ray = camera.getRayInPixel( x, y );
		var position = vec3.create();
		if( geo.testRayPlane( ray.origin, ray.direction, vec3.create(), vec3.fromValues(0,1,0), position ) )
			return position;
		return null;
	},

	onWebGLNotEnabled: function()
	{
		var dialog = LiteGUI.alert("WebGL is disabled in your browser.<br/> You must use a recent browser like Chrome or Firefox updated to the last version in order to use this tool.");
		dialog.setSize(400,200);

		this.canvas_container.innerHTML = "WEBGL is disabled</br><a href='http://superuser.com/questions/836832/how-can-i-enable-webgl-in-my-browser'>Do you need help?</a>";
		this.canvas_container.setAttribute("style","font-size: 4em; padding: 50px; color: #444; text-align: center; width: 100%;");
	}
};

CORE.registerModule( RenderModule );


RenderModule._depth_vertex_shader_code = "\n\
	precision highp float;\n\
	attribute vec3 a_vertex;\n\
	attribute vec2 a_coord;\n\
	uniform float u_depth;\n\
	void main() { \n\
		gl_Position = vec4(a_coord * 2.0 - 1.0, u_depth, 1.0);\n\
	}\n\
";

RenderModule._depth_fragment_shader_code = "\n\
	precision highp float;\n\
	uniform float u_color;\n\
	void main() {\n\
		gl_FragColor = vec4(u_color);\n\
}";






