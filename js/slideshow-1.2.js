/*
 * The MIT License (MIT)
 * 
 * Slideshow.js v1.2
 * Copyright (c) 2015 Kenny Deschuyteneer
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */


////// Checks if the correct jQuery version is in the current namespace.
if (typeof jQuery === 'undefined') {
	throw new Error("slideshow.js requires jQuery") }

+function($) {
	'use strict';
	var version = $.fn.jquery.split(' ')[0].split('.')
	if ((version[0] < 2 && version[1] < 9) || (version[0] == 1 && version[1] == 9 && version[2] < 1)) {
		throw new Error("slideshow.js requires jQuery version 1.9.1 or higher")
	}
}(jQuery);



/**
 Function: format(...)
 Description:
    Like Python's format function, is called on a string and replaces every occurence of {x} in the
    source string with the element with index x in the arguments.
**/
if (!String.prototype.format) {
	String.prototype.format = function() {
		var replacers = arguments;
		return this.replace(/{(\d+)}/g, function(original, number) {
			var replacer = replacers[number];
			return (typeof replacer != 'undefined') ? replacer : original;
		});
	};
};



////// A namespace to group a few timer-related functions, i.e. functions that are executed repeatedly at
////// a set interval.
(function(chrono, $) {

	chrono.Timer = function(delay, routine) {
		this.holder = {};
		this.delay = delay;
		this.routine = routine;
	};

	chrono.Timer.prototype.start = function() {
		this.holder = setInterval(this.routine, this.delay);
	};

	chrono.Timer.prototype.stop = function() {
		clearInterval(this.holder);
	};

	chrono.delay = function(delay, routine) {
		setTimeout(routine, delay);
	};

	chrono.repeat = function(delay, routine) {
		var t = new chrono.Timer(delay, routine);
		t.start();
		return t;
	};

}(window.chrono = window.chrono || {}, jQuery));



////// A namespace which groups all functions and classes related to the internal workings
////// of slideshow.js. On one hand, we have Animation, which contains the logic for the
////// automatic progression of the slides, and on the other hand, there's Controller, which
////// handles the logic for the control buttons of the slideshow.
(function(slideshow, $) {

	////// Global variables.
	slideshow.DEFAULT_DIRECTION = "horizontal";
	slideshow.DEFAULT_DELAY = 2000;
	slideshow.ANIMATION_SPEED = 600;


	////// Strings, ID's and names.
	slideshow.KEY_ANIMATION = "slideshow.animation";
	slideshow.KEY_ANIMATION_CURRENT = "slideshow.animation.current";
	slideshow.KEY_SLIDE_INDEX = "slideshow.slide.index";
	slideshow.KEY_CONTROLLER = "slideshow.controller";
	slideshow.KEY_CONTROLLER_LOCK = "slideshow.controller.lock";
	slideshow.KEY_CONTROLLER_TARGET = "target";
	slideshow.CLASS_SSC_CURRENT = "ssc-current";
	slideshow.CLASS_SSC_LOCKED = "ssc-locked";


	////// A slide takes up the entire space of its parent slideshow element. It
	////// should also transition for pretty animation effects.
	var css_default_slide = {
		position: "absolute",
		width: "100%",
		height: "100%",
		transition: "transform {0}ms, opacity {0}ms".format(slideshow.ANIMATION_SPEED) };


	////// Convenience function: create an object holding all possible states for a slide,
	////// given the direction of the animation, and from how far the transition should
	////// start.
	function slidestates(direction, offset) {
		switch(direction) {
			case "horizontal": var _direction = "X"; break;
			case "vertical": var _direction = "Y"; break;
		};

		return {
			start: {
				opacity: 0,
				transform: "translate{0}(-{1}px)".format(_direction, offset) },
			intermediate: {
				opacity: 1,
				transform: "translate{0}(0)".format(_direction) },
			end: {
				opacity: 0,
				transform: "translate{0}({1}px)".format(_direction, offset) } };
	};


	////// The offset, from which a slide gets "carried in" and to which it gets "carried out",
	////// is calculated as a third of the length of the parent container. For example, if the
	////// parent container is 900px wide, the slide will come in from 300px from the center.
	function calculateOffset(element, direction) {
		switch(direction) {
			case "horizontal":
				return element.width() / 3;
			case "vertical":
				return element.height() / 3; };
	};


	/**
	 Private Function: generateAnimationProcedure(slides, current, states)
	 Description:
	    Given a set of slide objects, marks the slide with given index as the current slide,
	    and generates a function that, when called, plays the animation and switches to the
	    next slide in the sequence.
	**/
	function generateAnimationProcedure(slides, current, states) {
		slides.data(slideshow.KEY_ANIMATION_CURRENT, current);

		return function() {
			var index = slides.data(slideshow.KEY_ANIMATION_CURRENT);
			var previous = slides.eq(index);
			previous.css(states.end);
			previous.data(slideshow.KEY_CONTROLLER).off();

			index = ++index % slides.length;
			slides.data(slideshow.KEY_ANIMATION_CURRENT, index);

			var current = slides.eq(index);
			current.transition().off();
			current.css(states.start);
			current.reflow();
			current.transition().on();
			current.css(states.intermediate);
			current.data(slideshow.KEY_CONTROLLER).on();
		};
	};


	/**
	 Object: Animation
	 Description:
	    Create an Animation object, for a given DOM object, where its children with the given
	    name are animated in a certain direction, with a certain delay betwee, each animation.
	**/
	slideshow.Animation = function(parent, childname, direction, delay) {
		// Handle optional variables.
		var _direction = (typeof direction === 'undefined') ? slideshow.DEFAULT_DIRECTION : direction;
		this.delay = (typeof delay === 'undefined') ? slideshow.DEFAULT_DELAY : delay;

		// Instantiate object.
		this.slides = {};
		this.states = slidestates(_direction, calculateOffset(parent, _direction));
		this.timer = {
			start: $.noop,
			stop: $.noop
		};

		if (parent.length == 1) {
			// Prepare the animation state.
			this.slides = parent.children(childname);
			this.timer = new chrono.Timer(this.delay, generateAnimationProcedure(this.slides, 0, this.states));

			// Prepare the involved elements for the animation.
			parent.css("position", "relative");
			this.slides.transition().off();
			this.slides.css(css_default_slide);
			this.slides.css(this.states.start);	
			this.slides.reflow();
			this.slides.transition().on();
			this.slides.eq(0).css(this.states.intermediate);

		} else {
			throw new Error("Can only install animation for a single element at a time"); }
	};

	/**
	 Function: Animation.skipto(index)
	 Description:
	    Sets the currently displayed slide to the one with the given index. The animation of
	    the sequence needs to be resumed manually after calling this function.
	**/
	slideshow.Animation.prototype.skipto = function(index) {
		// Stop the animation.
		this.timer.stop();

		// Do an animation to transition to the specified slide.
		var size = this.slides.length;
		var _index = (index < size) ? index : size - 1;
		var current = this.slides.data(slideshow.KEY_ANIMATION_CURRENT);
		if (index != current) {
			var previous = this.slides.eq(current);
			var next = this.slides.eq(_index);
			var states = this.states;
			
			previous.css(states.end);
			next.transition().off();
			next.css(states.start);
			next.reflow();
			next.transition().on();
			next.css(states.intermediate);

			previous.data(slideshow.KEY_CONTROLLER).off();
			next.data(slideshow.KEY_CONTROLLER).on(); };

		this.timer = new chrono.Timer(this.delay, generateAnimationProcedure(this.slides, _index, this.states));
	};

	/**
	 Function: Animation.resume()
	 Description:
	    (Re)starts the animation sequence if it was paused before.
	**/
	slideshow.Animation.prototype.resume = function() {
		this.timer.start();
	};

	/**
	 Function: Animation.pause()
	 Description:
	    Pauses the animation sequence.
	**/
	slideshow.Animation.prototype.pause = function() {
		this.timer.stop();
	};


	/**
	 Object: Controller
	 Description:
	    A controller is a collection of elements that represent which slide is currently
	    shown. One can attach and detach elements to this collection.
	**/
	slideshow.Controller = function() {
		this.data = $("undefined");
	};

	/**
	 Function: attach(elements)
	 Description:
	    Add a selection of DOM elements to this controller.
	**/
	slideshow.Controller.prototype.attach = function(elements) {
		this.data = this.data.add(elements);
	};

	/**
	 Function: detach(elements)
	 Description:
	    Remove a selection of DOM elements from this controller.
	**/
	slideshow.Controller.prototype.detach = function(elements) {
		this.data = this.data.not(elements);
	};

	/**
	 Function: Controller.on()
	 Description:
	    Switches to the "current" state for the controller.
	**/
	slideshow.Controller.prototype.on = function() {
		this.data.removeClass("ssc-locked");
		this.data.addClass("ssc-current");
	};

	/**
	 Function: Controller.off()
	 Description:
	    Switches to the default state for the controller.
	**/
	slideshow.Controller.prototype.off = function() {
		this.data.removeClass("ssc-current");
		this.data.removeClass("ssc-locked");
	};

	/**
	 Function: Controller.lock()
	 Description:
	    Switches to the "locked" state for the controller.
	**/
	slideshow.Controller.prototype.lock = function() {
		this.data.removeClass("ssc-current");
		this.data.addClass("ssc-locked");
	};

}(window.slideshow = window.slideshow || {}, jQuery));


////// When this script gets loaded, it extends jQuery with 4 functions, and automatically converts
////// DOM elements with the .slideshow class to a animated slideshow.
$(document).ready(function() {

	////// Inject the notransition class in the DOM. This class causes elements to ignore any
	////// transition rules set before.
	$("<style>")
		.prop("type", "text/css")
		.html(".notransition {\
					-webkit-transition: none !important; \
					-moz-transition: none !important; \
					-o-transition: none !important; \
					-ms-transition: none !important; \
					transition: none !important; }")
		.appendTo("head");


	$.fn.extend({

		/**
		 Function: reflow()
		 Description:
		    Force a layout of the DOM. Use with caution, as this could turn out to be quite
		    expensive! Uses one of the methods as described in
		    http://gent.ilcore.com/2011/03/how-not-to-trigger-layout-in-webkit.html
		**/
		reflow: function() {
			$(this)[0].offsetHeight;
			return $(this);
		},

		/**
		 Function: transition()
		 Description:
		    Returns an object which allows you to turn off the transitions set on a certain
		    element. This is done by adding a notranstion class to said element, which forces
		    the element to have "none" for transition value.
		**/
		transition: function() {
			var element = $(this);

			return {
				toString: function() {
					var state = element.hasClass("notransition") ? "on" : "off";
					return "Transitions for this element are turned " + state;
				},
				
				on: function() { element.removeClass("notransition"); },
				off: function() { element.addClass("notransition"); },
			};
		},

		/**
		 Function: slideshow(slidetype, direction, delay)
		 Description:
		    Generate a slideshow animation for the given elements. The slidetype parameter is used to
		    determine which child containers are used as the slides.
		 Parameters:
		    • slidetype: the class of the elements which should become the "slides" of the presentation
		    • direction (optional): the direction in which the slides should animate, either "horizontal"
		                            or "vertical"
		    • delay (optional): the duration in between animations
		**/
		slideshow: function(slidetype, direction, delay) {
			var containers = $(this);
			containers.each(function() {
				// Create the animation and bind as data to the container.
				var container = $(this);
				direction = direction ? direction : container.attr("data-direction");
				delay = delay ? delay : container.attr("data-delay") ;
				var animation = new slideshow.Animation(container, slidetype, direction, delay);
				container.data(slideshow.KEY_ANIMATION, animation);
				container.data(slideshow.KEY_CONTROLLER_LOCK, 0);

				// Enumerate the children and bind as data to them, so the slides remember
				// their index in the sequence.
				container.children(slidetype).each(function(index) {
					var slide = $(this);
					slide.data(slideshow.KEY_SLIDE_INDEX, index);
					slide.data(slideshow.KEY_CONTROLLER, new slideshow.Controller());
				});
			});

			return containers;
		},

		/**
		 Function: skip()
		 Description:
		    If the found element is a single child element of a slideshow container, sets the display of
		    the slideshow to that element and continues the presentation from there.
		**/
		skip: function() {
			var slide = $(this);
			if (slide.length == 1) {
				var animation = slide.parent().data(slideshow.KEY_ANIMATION);
				if (typeof animation != 'undefined') {
					animation.skipto(slide.data(slideshow.KEY_SLIDE_INDEX)); }; };

			return slide;
		},

		/**
		 Function: resume()
		 Description:
		    Resumes the animation of any slideshow-animated element.
		**/
		resume: function() {
			$(this).each(function() {
				var animation = $(this).data(slideshow.KEY_ANIMATION);
				if (animation) { animation.resume() };
			});

			return $(this);
		},

		/**
		 Function: pause()
		 Description:
		    Puts the animation of any slideshow-animated element on hold.
		**/
		pause: function() {
			$(this).each(function() {
				var animation = $(this).data(slideshow.KEY_ANIMATION);
				if (animation) { animation.pause() };
			});

			return $(this);
		},

		/**
		 Function: controller(target)
		 Description:
		    Turns the DOM elements in the selection into slideshow controllers. The given target
		    will be the element it controls.
		**/
		controller: function(target) {
			var controllers = $(this);
			controllers.each(function() {
				// Pull target from attribute if not explicitly passed. If there is no data-target
				// attribute defined on the element, throw an error.
				var _target = target ? target : $(this).data(slideshow.KEY_CONTROLLER_TARGET);
				if (!_target) { return; }

				var target_element = $(_target);
				var target_container = target_element.parent();
				target_element.data(slideshow.KEY_CONTROLLER).attach($(this));

				function getLock() { return target_container.data(slideshow.KEY_CONTROLLER_LOCK); }

				function mouseenter() { if (!getLock()) { target_element.skip() } };
				function mouseleave() { if (!getLock()) { target_container.resume() } };

				function lock() {
					var existing_lock = getLock();

					// If the lock is not on this slide..
					if (existing_lock != _target) {
						var prev_controller = $(existing_lock).data(slideshow.KEY_CONTROLLER);
						if (existing_lock) { prev_controller.off(); };
						target_element.skip();
						target_element.data(slideshow.KEY_CONTROLLER).lock();
						target_container.data(slideshow.KEY_CONTROLLER_LOCK, _target);

					// If this slide is locked right now..
					} else {
						target_element.data(slideshow.KEY_CONTROLLER).on();
						target_container.data(slideshow.KEY_CONTROLLER_LOCK, 0); }
				};

				$(this).click(lock);
				$(this).hover(mouseenter, mouseleave);
			});

			var first_target = controllers.eq(0).attr("data-target");
			$(first_target).data(slideshow.KEY_CONTROLLER).on();

			return $(this);
		}
	});

	////// It's possible to use this plugin without having to code any Javascript. Any element with
	////// the "slideshow" class will have any child element with the "slide" class animated. Any
	////// element with the "slideshow-controller" class will behave as a controller for its data-target.
	$(".slideshow").slideshow(".slide").resume();
	$(".slideshow-controller").controller();

});
