(function() {
    bindNavBtnEvent();

    /**
     * 绑定菜单点击事件
     */
    function bindNavBtnEvent() {
        var btn = document.getElementById('header-btn');
        btn.addEventListener('click', toggleNav, false);
    }

    /**
     * 菜单的展开收起
     */
    function toggleNav() {
    	var nav = document.querySelector('.nav-wise');
        util.toggleClass(nav, 'hide');
    }

    /**
     * 操作dom class工具
     */
    var util = {
    	// used multiple times
        containReg: function (txt) {
            return new RegExp('(\\s+|^)' + txt + '(\\s+|$)');
        },
        // check if dom has certain class
        hasClass: function(ele, cls) {
            return ele.className.match(this.containReg(cls));
        },
        // add certain class to dom
        addClass: function(ele, cls) {
            if (this.hasClass(ele, cls)) {
                return;
            }
            ele.className = (ele.className + ' ' + cls).trim();
        },
        // remove certain class from dom
        removeClass: function(ele, cls) {
            if (!this.hasClass(ele, cls)) {
                return;
            }
            ele.className = ele.className.replace(this.containReg(cls), ' ').trim();
        },
        // toggle certain class of dom
        toggleClass: function(ele, cls) {
            if (this.hasClass(ele, cls)) {
                this.removeClass(ele, cls);
            } else {
                this.addClass(ele, cls);
            }
        }
    };


})();