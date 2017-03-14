var CodingModule = //do not change
{
	name: "Code",
	bigicon: "imgs/tabicon-code.png",

	show_sceneview: true, //3d view
	show_panel: false, //side panel

	is_sceneview_visible: true, 

	APIs: {}, //here you can register function calls of the API
	windows: [], //external windows

	init: function()
	{
		this.tab = LiteGUI.main_tabs.addTab( this.name, {
			id:"codingtab",
			bigicon: this.bigicon,
			size: "full", 
			callback: function(tab) {
				CodingModule.show3DWindow( CodingModule.show_sceneview );
				CodingModule.showSidePanel( CodingModule.show_panel );
				CodingModule.coding_tabs_widget.refresh();
			},
			callback_canopen: function(){
				//avoid opening the tab if it is in another window
				if(CodingModule.external_window)
					return false;
			},
			callback_leave: function() {
				RenderModule.appendViewportTo(null);
				//CodingModule.assignCurrentCode();
			},
			module: this //used to catch keyboard events
		});

		this.root = LiteGUI.main_tabs.getTab(this.name).content;

		//tabs for every file
		//register some APIs used for autocompletion
		
		//this.registerAPI("glsl", ["uniform","varying","sampler2D","samplerCube"] );
		this.registerAPI("glsl", ["texture2D","textureCube","radians","degrees","sin","cos","tan","asin","acos","atan","pow","exp","log","exp2","length"] );
		this.registerAPI("glsl", ["IN.color","IN.vertex","IN.normal","IN.uv","IN.uv1","IN.camPos","IN.viewDir","IN.worldPos","IN.worldNormal","IN.screenPos"] );
		this.registerAPI("glsl", ["o.Albedo","o.Normal","o.Emission","o.Specular","o.Gloss","o.Alpha","o.Reflectivity"] );

		LiteGUI.menubar.add("Window/Coding Panel", { callback: function(){ CodingTabsWidget.createDialog(); }});
		LiteGUI.menubar.add("Actions/Catch Exceptions", { type: "checkbox", instance: LS, property: "catch_exceptions" });

		var coding_area = this.coding_area = new LiteGUI.Area("codearea",{height: "100%"});
		this.root.appendChild( coding_area.root );
		coding_area.split("horizontal",[null,"50%"],true);

		var left_area = coding_area.getSection(0);
		left_area.split("vertical",[null,"25%"],true);

		this.coding_3D_area = left_area.getSection(0).content;
		this.console_area = left_area.getSection(1).content;

		//CONSOLE
		this.console_widget = new ConsoleWidget();
		this.console_area.appendChild( this.console_widget.root );

		//console._log = console.log;
		//console.log = this.onConsoleLog.bind(this);

		//CODING
		var coding_tabs_widget = this.coding_tabs_widget = new CodingTabsWidget();
		coding_tabs_widget.is_master_editor = true;
		coding_area.getSection(1).add( coding_tabs_widget );
		//coding_tabs_widget.onNewTab();

		LEvent.bind( LS, "code_error", this.onCodeError, this );

		LS.catch_exceptions = true;
	},

	//registers a coding API (help, links to wiki, autocompletion, etc)
	registerAPI: function( lang, funcs )
	{
		var API = this.APIs[lang];
		if( !this.APIs[lang] )
			API = this.APIs[lang] = {};

		for(var i in funcs)
			API[ funcs[i] ] = true;
	},

	//open coding tab
	openTab: function()
	{
		LiteGUI.main_tabs.selectTab( this.name );
		this.show3DWindow( true );
	},

	//close coding tab ( back to scene view )
	closeTab: function()
	{
		LiteGUI.main_tabs.selectTab( RenderModule.name );
	},

	//switch coding tab
	editInstanceCode: function( instance, options, open_tab )
	{
		if(!instance)
			return;
		if(open_tab)
			this.openTab();
		this.coding_tabs_widget.editInstanceCode( instance, options );
	},

	closeInstanceTab: function( instance, options )
	{
		return this.coding_tabs_widget.closeInstanceTab( instance, options );
	},

	//
	onNewScript: function( node, type )
	{
		type = type || "Script";
		node = node || SelectionModule.getSelectedNode();
		if(!node)
			node = LS.GlobalScene.root;

		if(type == "Script")
		{
			var component = new LS.Components.Script();
			node.addComponent( component );
			this.editInstanceCode( component, { id: component.uid, title: node.id, lang: "javascript", path: component.uid, help: LS.Components.Script.coding_help });
			this.openTab();
		} 
		else if (type == "ScriptFromFile")
		{
			var component = new LS.Components.ScriptFromFile();
			node.addComponent( component );
		}
		else if (type == "Global")
		{
			LiteGUI.alert("TO DO");
		}
	},

	//used to extract editor options of a given instance
	extractOptionsFromInstance: function( instance, options )
	{
		if(!instance)
		{
			console.error("instance cannot be null");
			return;
		}

		options = options || {};

		//compute id
		var fullpath = instance.fullpath || instance.filename; //for resources
		var uid = instance.uid || instance.name; //for components
		var id = options.id || fullpath || uid;
		options.id = id;

		if(fullpath)
			fullpath = LS.RM.cleanFullpath(fullpath);

		//compute title
		var title = options.title;
		if(!title)
		{
			if(fullpath) //resources
				title = LS.RM.getFilename( fullpath );
			if(instance.getComponentTitle) //scripts
				title = instance.getComponentTitle();
		}
		options.title = title || "Script";

		//compute lang
		var lang = options.lang;
		if( !lang )
		{
			if( instance.constructor.is_material || instance.constructor == LS.ShaderCode ) 
				lang = "glsl";
			if( fullpath )
			{
				var ext = LS.RM.getExtension(fullpath);
				if( ext == "js" )
					lang = "javascript";
				else if( ext == "txt" )
					lang = "text";
				else
					lang = ext;
			}
		}
		options.lang = lang || "javascript";

		//compute type
		if(instance.constructor.is_resource)
			options.type = LS.TYPES.RESOURCE;
		else if(instance.constructor.is_component)
			options.type = LS.TYPES.COMPONENT;
		else if(instance.constructor.is_material)
			options.type = LS.TYPES.MATERIAL;

		return options;
	},

	//finds instance from options using id and type
	findInstance: function( options, callback )
	{
		var id = options.id;
		if(!id)
		{
			console.warn("findInstance options without id");
			return null;
		}

		//get instance from options
		if(options.type == LS.TYPES.RESOURCE)
		{
			if(LS.RM.resources[ id ])
				return LS.RM.resources[ id ];
			LS.RM.load( id, null, function(res){
				if(callback)
					callback( res, options );
			});
			return null;
		}
		else if(options.type == LS.TYPES.COMPONENT)
		{
			var comp = LS.GlobalScene.findComponentByUId( id );
			if(callback)
				callback( comp, options );
			return comp;
		}
		else
			console.warn("Cannot find code instance: ",id );
		return null;
	},

	showCodingHelp: function( options )
	{
		var help = options.help;
		if(!help)
		{
			if(options.type === LS.TYPES.COMPONENT)
			{
				window.open( "https://github.com/jagenjo/litescene.js/blob/master/guides/scripting.md"	);
			}
			else if(options.type === LS.TYPES.RESOURCE)
			{
				if(options.lang == "glsl")
				{
					if(LS.ShaderCode.help_url)
						window.open( LS.ShaderCode.help_url	);
					return;
					//help = LS.SurfaceMaterial.coding_help;
				}
				else
					window.open( "https://github.com/jagenjo/litescene.js/blob/master/guides/scripting.md"	);
			}
			else
				return;
		}

		var help_options = {
			content: "<pre style='padding:10px; height: 200px; overflow: auto'>" + help + "</pre>",
			title: "Help",
			draggable: true,
			closable: true,
			width: 400,
			height: 260
		};

		var dialog = new LiteGUI.Dialog("info_message",help_options);
		dialog.addButton("Close",{ close: true });
		dialog.show();
	},

	onCodeError: function( e,err )
	{
		//if it is an script of ours, open in code editor
		if(!err.script)
			return;

		var tab = this.coding_tabs_widget.editInstanceCode( err.script );
		if(!tab || !tab.pad)
			return;

		this.openTab();
		tab.pad.markError( err.line, err.msg );

		InterfaceModule.setStatusBar("Error in code: " + err.msg, "error" );
	},

	//shows the side 3d window
	show3DWindow: function(v)
	{
		if(v === undefined)
			v = !this.is_sceneview_visible;
		this.is_sceneview_visible = v;
		this.show_sceneview = v;

		if(v)
		{
			RenderModule.appendViewportTo( this.coding_area.sections[0].content );
			this.coding_area.showSection(0);
		}
		else
		{
			RenderModule.appendViewportTo(null);
			this.coding_area.hideSection(0);
		}
	},

	showSidePanel: function(v)
	{
		InterfaceModule.setSidePanelVisibility(v);
		this.show_panel = InterfaceModule.side_panel_visibility;

	},

	onKeyDown: function(e)
	{
		//this key event must be redirected when the 3D area is selected
		if( this._block_event )
			return;
		this._block_event = true;
		var coding = this.coding_tabs_widget.root.querySelector(".CodeMirror");
		if(coding)
			coding.dispatchEvent( new e.constructor( e.type, e ) );
		this._block_event = false;
	},

	onUnload: function()
	{
		if(this.external_window)
			this.external_window.close();
	},

	//get the current state
	getState: function()
	{
		return this.coding_tabs_widget.getState();
	},

	//get the current state
	setState: function(o)
	{
		return this.coding_tabs_widget.setState(o);
	},

	onConsoleLog: function(a,b)
	{
		console._log.apply( console, arguments );

		var elem = document.createElement("div");
		elem.className = "msg";
		a = String(a);
		if( a.indexOf("%c") != -1)
		{
			a = a.split("%c").join("");
			elem.setAttribute("style",b);
		}
		elem.innerText = a;
		this.console_container.appendChild( elem );
		this.console_container.scrollTop = 1000000;
		if( this.console_container.childNodes.length > 500 )
			this.console_container.removeChild( this.console_container.childNodes[0] );
	}
};

CORE.registerModule( CodingModule );

/* editors **************************************/

LS.Components.Script.prototype.getExtraTitleCode = LS.Components.ScriptFromFile.prototype.getExtraTitleCode = function()
{
	return "<span class='icon script-context-icon'><img src='" + EditorModule.icons_path + LS.Script.icon + "'/></span>";
}

LS.Components.Script["@inspector"] = function( component, inspector )
{
	var context_locator = component.getLocator() + "/context";
	var context = component.getContext();

	var icon = this.current_section.querySelector(".script-context-icon");
	icon.addEventListener("dragstart", function(event) { 
		event.dataTransfer.setData("uid", context_locator );
		event.dataTransfer.setData("locator", context_locator );
		event.dataTransfer.setData("type", "object");
		event.dataTransfer.setData("node_uid", component.root.uid);
		if( component.setDragData )
			component.setDragData( event );
	});

	inspector.addButton(null,"Edit Code", { callback: function() {
		CodingModule.openTab();
		var path = component.uid;
		CodingModule.editInstanceCode( component );
	}});

	if(context)
	{
		if(context.onInspector)
			context.onInspector( inspector );
		else
			this.showObjectFields( context, inspector );
	}
}

LS.Components.ScriptFromFile["@inspector"] = function( component, inspector )
{
	inspector.widgets_per_row = 2;
	inspector.addResource( "Filename", component.filename, { width: "75%", category: "Script", align:"right", callback: function(v) { 
		component.filename = v;
	}});

	inspector.addButton(null,"Edit Code", { width: "25%", callback: function() {
		var path = component.uid;
		if(!component.filename)
		{
			/*
			LiteGUI.prompt("Choose a filename", function(filename){
				if(!filename)
					return;
				CodingModule.openTab();
				var res = new LS.Resource();
				var extension = LS.RM.getExtension(filename);
				if(extension != "js")
					filename = filename + ".js";
				component.filename = filename;
				LS.RM.registerResource(filename,res);
				CodingModule.editInstanceCode( res );
			});
			*/
			DriveModule.showCreateScriptDialog({filename: "script.js"}, function(resource){
				if(!resource)
					return;
				CodingModule.openTab();
				var fullpath = resource.fullpath || resource.filename;
				component.filename = fullpath;
				CodingModule.editInstanceCode( resource );
			});
			return;
		}

		CodingModule.openTab();
		var res = LS.ResourcesManager.load( component.filename, null, function(res){
			CodingModule.editInstanceCode( res );
		});
	}});
	inspector.widgets_per_row = 1;

	var context = component.getContext();
	if(context)
	{
		if(context.onInspector)
			context.onInspector( inspector );
		else
			this.showObjectFields(context, inspector );
	}
}

LS.Components.Script.prototype.onComponentInfo = function( widgets )
{
	var component = this;

	var locator_widget = widgets.addString("Context Locator", this.getLocator() + "/context", { disabled: true } );

	var values = [""];
	var context = this.getContext();
	if(context)
	{
		for(var i in context)
		{
			var f = context[i];
			if( typeof(f) != "function")
				continue;
			values.push(i);
		}
		widgets.addCombo("Functions", "", { values: values, callback: function(v){ 
			//TODO
		}});
	}
}

//to write a tiny code snippet
LiteGUI.Inspector.prototype.addCode = function( name, value, options )
{
	options = options || {};
	value = value || "";
	var that = this;
	this.values[ name ] = value;

	var element = null;

	var instance = options.instance || {};
	var uid = instance.uid || ("code_" + this.tab_index);
	var instance_settings = { 
		id: uid,
		path: instance.uid,
		title: uid
	};
	//getCode: function(){ return instance[name];},
	//setCode: function(v){ instance[name] = v;}

	if(!options.allow_inline)
	{
		var text = "Edit Code";
		element = this.createWidget(name,"<button class='single' tabIndex='"+ this.tab_index + "'>"+text+"</button>", options);
		var button = element.querySelector("button");
		button.addEventListener("click", function() {
			CodingModule.openTab();
			CodingModule.editInstanceCode( instance, instance_settings );
		});
	}
	else
	{
		element = inspector.addContainer( null, { height: 300} );

		var codepad = new CodingPadWidget();
		element.appendChild( codepad.root );
		codepad.editInstanceCode( instance, instance_settings );
		codepad.top_widgets.addButton(null,"In Editor",{ callback: function() { 
			if(options.callback_button)
				options.callback_button();
			inspector.refresh();
			CodingModule.openTab();
			CodingModule.editInstanceCode( instance, instance_settings );
		}});
	}

	this.tab_index += 1;
	this.append( element );
	return element;
}

LiteGUI.Inspector.widget_constructors["code"] = "addCode";


LS.Components.Script.actions["breakpoint_on_call"] = { 
	title: "Breakpoint on call", 
	callback: function() { 
		if(!this._root)
		{
			console.warn("Script is not attached to a node?");
			return;
		}
		this._breakpoint_on_call = true;
	}
};



LS.Components.Script.actions["convert_to_script"] = { 
	title: "Convert to ScriptFromFile", 
	callback: function() { 
		if(!this._root)
		{
			console.warn("Script is not attached to a node?");
			return;
		}

		var node = this._root;
		var info = this.serialize();
		var code = this.getCode();
		delete info.code;
		var compo = this;

		LiteGUI.prompt("Choose a filename for the source file", function(v){

			var resource = new LS.Resource();
			resource.setData( code );
			LS.RM.registerResource( v, resource );
			info.filename = resource.filename;

			var index = node.getIndexOfComponent(compo);
			node.removeComponent(compo);

			var script = new LS.Components.ScriptFromFile();
			node.addComponent(script, index);
			script.configure(info);
			EditorModule.refreshAttributes();

			console.log("Script converted to ScriptFromFile");
		},{ value:"unnamed_code.js" });
	}
};

LS.Components.ScriptFromFile.actions = {}; //do not share with script
LS.Components.ScriptFromFile.actions["convert_to_script"] = { 
	title: "Convert to Script", 
	callback: function() { 
		if(!this._root)
		{
			console.warn("Script is not attached to a node?");
			return;
		}

		var node = this._root;
		var info = this.serialize();
		delete info.filename;
		info.code = this.getCode();
		var script = new LS.Components.Script();
		var index = node.getIndexOfComponent(this);
		node.removeComponent(this);
		node.addComponent(script, index);
		script.configure(info);
		EditorModule.refreshAttributes();
		console.log("ScriptFromFile converted to Script");
	}
};

LS.Components.ScriptFromFile.actions["breakpoint_on_call"] = LS.Components.Script.actions["breakpoint_on_call"];
