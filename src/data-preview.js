(function ($) {
  var dp = {};

  // Set up in DOM ready.
  dp.$dialog = null;

  // Time to wait for a JSONP request to timeout.
  dp.timeout = 5000;

  // True when plugin dependancies have been loaded.
  dp.areDependanciesLoaded = false;

  // Key to use when saving the charts onto a resource.
  dp.resourceChartKey = 'datapreview-charts';

  // Template url. The html property is populated on load.
  dp.template = {
    html: ''
  };

  dp.normalizeFormat = function(format) {
    var out = format.toLowerCase();
    out = out.split('/');
    out = out[out.length-1];
    return out;
  };

  dp.normalizeUrl = function(url) {
    if (url.indexOf('https') === 0) {
      return 'http' + url.slice(5);
    } else {
      return url;
    }
  }

  // Public: Escapes HTML entities to prevent broken layout and XSS attacks
  // when inserting user generated or external content.
  //
  // string - A String of HTML.
  //
  // Returns a String with HTML special characters converted to entities.
  //
  dp.escapeHTML = function (string) {
    return string.replace(/&(?!\w+;|#\d+;|#x[\da-f]+;)/gi, '&amp;')
                 .replace(/</g, '&lt;').replace(/>/g, '&gt;')
                 .replace(/"/g, '&quot;')
                 .replace(/'/g, '&#x27')
                 .replace(/\//g,'&#x2F;');
  };

  // Public: Requests the formatted resource data from the webstore and
  // passes the data into the callback provided.
  //
  // preview - A preview object containing resource metadata.
  // callback - A Function to call with the data when loaded.
  //
  // Returns nothing.
  //
  dp.getResourceDataDirect = function(preview, callback) {
    // $.ajax() does not call the "error" callback for JSONP requests so we
    // set a timeout to provide the callback with an error after x seconds.
    var timer = setTimeout(function error() {
      callback(preview, {
        error: {
          title: 'Request Error',
          message: 'Dataproxy server did not respond after ' + (dp.timeout / 1000) + ' seconds'
        }
      });
    }, dp.timeout);

    // have to set jsonp because webstore requires _callback but that breaks jsonpdataproxy
    var jsonp = '_callback';
    if (preview.url.indexOf('jsonpdataproxy') != -1) {
      jsonp = 'callback';
    }

    // We need to provide the `cache: true` parameter to prevent jQuery appending
    // a cache busting `={timestamp}` parameter to the query as the webstore
    // currently cannot handle custom parameters.
    $.ajax({
      url: preview.url,
      cache: true,
      dataType: 'jsonp',
      jsonp: jsonp,
      success: function(data) {
        clearTimeout(timer);
        callback(preview, data);
      }
    });
  };

  // Public: Loads the plugin UI into the dialog and sets up event listeners.
  //
  // preview - A preview object containing resource data.
  // columns - Column Array formatted for use in SlickGrid.
  // data    - A data Array for use in SlickGrid.
  //
  // Returns nothing.
  //
  dp.loadDataPreview = function (preview, columns, data) {
    var dialog = dp.$dialog;

    // Need to create the grid once the dialog is open for cells to render
    // correctly.
    dialog.dialog(dp.dialogOptions).one("dialogopen", function () {
      var element  = $(dp.template.html).appendTo(dialog);
      var viewer   = new dp.createDataPreview(element, columns, data);
      var apiKey   = $.cookie('ckan_apikey');

      // Load chart data from external source
      // TODO: reinstate
      // this used to load chart info from related CKAN dataset
      viewer.editor.loading();
      viewer.editor.loading(false).disableSave();

      // Save chart data to the client provided callback
      // TODO: implement
      viewer.editor.bind('save', function (chart) {
        viewer.editor.saving();
        viewer.editor.saving(false);
      });

      dialog.bind("dialogresizestop.data-preview", viewer.redraw);

      // Remove bindings when dialog is closed.
      dialog.bind("dialogbeforeclose", function () {
        dialog.unbind(".data-preview");
      });
    });
  };

  // Public: Sets up the dialog for displaying a full screen of data.
  //
  // preview - A preview object containing resource data.
  //
  // Returns nothing.
  //
  dp.setupFullscreenDialog = function (preview) {
    var dialog = dp.$dialog, $window = $(window), timer;

    dialog.empty().dialog('option', 'title', 'Preview: ' + preview.source);

    // Ensure the lightbox always fills the screen.
    $window.bind('resize.data-preview', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        dialog.dialog('option', {
          width:  $window.width()  - 20,
          height: $window.height() - 20
        });
        dialog.trigger('dialogresizestop');
      }, 100);
    });

    dialog.bind("dialogbeforeclose", function () {
      $window.unbind("resize.data-preview");
    });
  }

  // Public: Displays a smaller alert style dialog with an error message.
  //
  // error - An error object to display.
  //
  // Returns nothing.
  //
  dp.showError = function (error) {
    var _html = '<strong>' + $.trim(error.title) + '</strong><br />' + $.trim(error.message);
    dp.$dialog.html(_html).dialog(dp.errorDialogOptions);
  };

  // Public: Displays the datapreview UI in a fullscreen dialog.
  //
  // This method also parses the data returned by the webstore for use in
  // the data preview UI.
  //
  // preview - A preview object containing resource data.
  // data    - An object of parsed CSV data returned by the webstore.
  //
  // Returns nothing.
  //
  dp.showData = function(preview, data) {
    dp.setupFullscreenDialog(preview);

    if(data.error) {
      return dp.showError(data.error);
    }
    var tabular = dp.convertData(data);

    dp.loadDataPreview(preview, tabular.columns, tabular.data);
  };

  // **Public: parse data from webstore or other source into form for data
  // preview UI**
  //
  // :param data: An object of parsed CSV data returned by the webstore.
  //
  // :return: parsed data.
  //
  dp.convertData = function(data) {
    var tabular = {
      columns: [],
      data: []
    };
    isNumericRegex = (/^[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?$/);

    // two types of data: that from webstore and that from jsonpdataproxy
    // if fields then from dataproxy
    if (data.fields) {
      tabular.columns = $.map(data.fields || [], function (column, i) {
        return {id: 'header-' + i, name: column, field: 'column-' + i, sortable: true};
      });

      tabular.data = $.map(data.data || [], function (row, id) {
        var cells = {id: id};
        for (var i = 0, c = row.length; i < c; i++) {
          var isNumeric = isNumericRegex.test(row[i]);
          cells['column-' + i] = isNumeric ? parseFloat(row[i]) : row[i];
        }
        return cells;
      });
    } else {
      tabular.columns = $.map(data.keys, function(key, idx) {
        return {id: 'header-' + key, name: key, field: 'column-' + key, sortable: true};
      });
      tabular.data = $.map(data.data, function(row, id) {
        var cells = {id: id};
        for(i in row) {
          var val = row[i];
          var isNumeric = isNumericRegex.test(val);
          cells['column-' + tabular.columns[i].name] = isNumeric ? parseFloat(val) : val;
        }
        return cells;
      });
    }
    return tabular;
  };

  // Public: Displays a String of data in a fullscreen dialog.
  //
  // preview - A preview object containing resource data.
  // data    - An object of parsed CSV data returned by the webstore.
  //
  // Returns nothing.
  //
  dp.showPlainTextData = function(preview, data) {
    dp.setupFullscreenDialog(preview);

    if(data.error) {
      dp.showError(data.error);
    } else {
      var content = $('<pre></pre>');
      for (var i=0; i<data.data.length; i++) {
        var row = data.data[i].join(',') + '\n';
        content.append(dp.escapeHTML(row));
      }
      dp.$dialog.dialog('option', dp.dialogOptions).append(content);
    }
  };

  // Public: Displays a fullscreen dialog with the url in an iframe.
  //
  // url - The URL to load into an iframe.
  //
  // Returns nothing.
  //
  dp.showHtml = function(url) {
    dp.$dialog.empty();
    dp.$dialog.dialog('option', 'title', 'Preview: ' + url);
    var el = $('<iframe></iframe>');
    el.attr('src', url);
    el.attr('width', '100%');
    el.attr('height', '100%');
    dp.$dialog.append(el).dialog('open');;
  };

  // Public: Loads a data preview dialog for a preview button.
  //
  // Fetches the preview data object from the link provided and loads the
  // parsed data from the webstore displaying it in the most appropriate
  // manner.
  //
  // link - An anchor Element.
  //
  // Returns nothing.
  //
  dp.loadPreviewDialog = function(link) {
    var preview  = $(link).data('preview');
    preview.url  = dp.normalizeUrl(link.href);
    preview.type = dp.normalizeFormat(preview.format);

    function callbackWrapper(callback) {
      return function () {
        var context = this, args = arguments;
      };
    }

    $(link).addClass('resource-preview-loading').text('Loading');

    if (preview.type === '') {
      var tmp = preview.url.split('/');
      tmp = tmp[tmp.length - 1];
      tmp = tmp.split('?'); // query strings
      tmp = tmp[0];
      var ext = tmp.split('.');
      if (ext.length > 1) {
        preview.type = ext[ext.length-1];
      }
    }

    if (preview.type in {'csv': '', 'xls': ''}) {
      dp.getResourceDataDirect(preview, callbackWrapper(dp.showData));
    }
    else if (preview.type in {
        'rdf+xml': '',
        'owl+xml': '',
        'xml': '',
        'n3': '',
        'n-triples': '',
        'turtle': '',
        'plain': '',
        'atom': '',
        'tsv': '',
        'rss': '',
        'txt': ''
        }) {
      // treat as plain text
      dp.getResourceDataDirect(preview, callbackWrapper(dp.showPlainTextData));
    }
    else {
      // very hacky but should work
      callbackWrapper(dp.showHtml)(preview.url);
    }
  };

  // Public: Kickstarts the plugin.
  //
  // dialogId    - The id of the dialog Element in the page.
  // options     - An object containing aditional options.
  //               timeout: Time in seconds to wait for a JSONP timeout.
  //
  // Examples
  //
  //   var url = 'http://test-webstore.ckan.net/okfn';
  //   dp.initialize(url, '#dialog', {timeout: 3000});
  //
  // Returns nothing.
  //
  dp.initialize = function(dialogId, options) {
    dp.$dialog = $('#' + dialogId);
    options = options || {};

    dp.timeout = options.timeout || dp.timeout;

    var _height = Math.round($(window).height() * 0.6);

    // Large stylable dialog for displaying data.
    dp.dialogOptions = {
      autoOpen: false,
      // does not seem to work for width ...
      position: ['center', 'center'],
      buttons: [],
      width:  $(window).width()  - 20,
      height: $(window).height() - 20,
      resize: 'auto',
      modal: false,
      draggable: true,
      resizable: true
    };

    // Smaller alert style dialog for error messages.
    dp.errorDialogOptions = {
      title: 'Unable to Preview - Had an error from dataproxy',
      position: ['center', 'center'],
      buttons: [{
        text: "OK",
        click: function () { $(this).dialog("close"); }
      }],
      width: 360,
      height: 180,
      resizable: false,
      draggable: false,
      modal: true,
      position: 'fixed'
    };
  };

  // Export the CKANEXT object onto the window.
  $.extend(true, window, {CKANEXT: {}});
  CKANEXT.DATAPREVIEW = dp;

})(jQuery);
