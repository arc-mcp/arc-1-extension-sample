CLASS zcl_arc1_forms_sample DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_http_extension.
  PRIVATE SECTION.
    TYPES: BEGIN OF result_type,
             status TYPE i,
             body TYPE string,
           END OF result_type.
    CONSTANTS max_bytes TYPE i VALUE 1048576.
    METHODS read_so10
      IMPORTING name TYPE string language TYPE sylangu text_id TYPE tdid
      RETURNING VALUE(result) TYPE result_type.
    METHODS read_sapscript
      IMPORTING name TYPE string language TYPE sylangu
      RETURNING VALUE(result) TYPE result_type.
    METHODS read_smartform
      IMPORTING name TYPE string language TYPE sylangu
      RETURNING VALUE(result) TYPE result_type.
    METHODS respond
      IMPORTING server TYPE REF TO if_http_server result TYPE result_type.
ENDCLASS.

CLASS zcl_arc1_forms_sample IMPLEMENTATION.
  METHOD if_http_extension~handle_request.
    IF server->request->get_method( ) <> 'GET'.
      server->response->set_header_field( name = 'Allow' value = 'GET' ).
      respond( server = server result = VALUE #( status = 405 body = '{"error":"GET required"}' ) ).
      RETURN.
    ENDIF.

    DATA(kind) = server->request->get_form_field( 'kind' ).
    DATA(name) = server->request->get_form_field( 'name' ).
    DATA(lang) = server->request->get_form_field( 'language' ).
    DATA(id) = server->request->get_form_field( 'textId' ).
    DATA(max_name) = SWITCH i( kind WHEN 'sapscript' THEN 16 WHEN 'smartform' THEN 30 WHEN 'so10' THEN 70 ELSE 0 ).
    IF max_name = 0 OR name IS INITIAL OR strlen( name ) > max_name
        OR name CN 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_/-'
        OR strlen( lang ) <> 1
        OR strlen( id ) > 4 OR ( id IS NOT INITIAL AND id CN 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_' )
        OR ( kind <> 'so10' AND id IS NOT INITIAL ).
      respond( server = server result = VALUE #( status = 400 body = '{"error":"Invalid form key"}' ) ).
      RETURN.
    ENDIF.
    DATA language TYPE sylangu.
    language = lang.
    SELECT SINGLE spras FROM t002 INTO @DATA(known_language) WHERE spras = @language.
    IF sy-subrc <> 0.
      respond( server = server result = VALUE #( status = 400 body = '{"error":"Unknown SAP language key"}' ) ).
      RETURN.
    ENDIF.

    DATA result TYPE result_type.
    CASE kind.
      WHEN 'so10'.
        DATA text_id TYPE tdid.
        text_id = COND #( WHEN id IS INITIAL THEN 'ST' ELSE id ).
        result = read_so10( name = name language = language text_id = text_id ).
      WHEN 'sapscript'.
        result = read_sapscript( name = name language = language ).
      WHEN 'smartform'.
        result = read_smartform( name = name language = language ).
    ENDCASE.
    respond( server = server result = result ).
  ENDMETHOD.

  METHOD respond.
    DATA(body) = cl_abap_codepage=>convert_to( result-body ).
    DATA(status) = result-status.
    IF xstrlen( body ) > max_bytes.
      status = 413.
      body = cl_abap_codepage=>convert_to( '{"error":"Response exceeds 1 MiB; no partial result returned"}' ).
    ENDIF.
    server->response->set_status( code = status reason = COND #( WHEN status = 200 THEN 'OK' ELSE 'Forms read failed' ) ).
    server->response->set_content_type( 'application/json; charset=utf-8' ).
    server->response->set_header_field( name = 'Cache-Control' value = 'no-store' ).
    server->response->set_header_field( name = 'X-Content-Type-Options' value = 'nosniff' ).
    server->response->set_data( body ).
  ENDMETHOD.

  METHOD read_so10.
    DATA text_name TYPE tdobname.
    text_name = name.
    AUTHORITY-CHECK OBJECT 'S_SCRP_TXT'
      ID 'TEXTNAME' FIELD text_name ID 'TEXTID' FIELD text_id
      ID 'LANGUAGE' FIELD language ID 'ACTVT' FIELD '03'.
    DATA(allowed) = xsdbool( sy-subrc = 0 ).
    TEST-SEAM text_authority.
    END-TEST-SEAM.
    IF allowed = abap_false.
      result = VALUE #( status = 403 body = '{"error":"Display authorization required"}' ).
      RETURN.
    ENDIF.

    " READ_TEXT follows references without checking the target's authorization.
    SELECT SINGLE tdrefobj, tdrefname, tdrefid FROM stxh INTO @DATA(reference)
      WHERE tdobject = 'TEXT' AND tdname = @text_name AND tdid = @text_id AND tdspras = @language.
    IF sy-subrc <> 0.
      result = VALUE #( status = 404 body = '{"error":"Text not found in current client and language"}' ).
      RETURN.
    ENDIF.
    IF reference IS NOT INITIAL.
      result = VALUE #( status = 409 body = '{"error":"Referenced texts are not supported"}' ).
      RETURN.
    ENDIF.
    DATA: BEGIN OF payload,
            version TYPE i VALUE 1,
            kind TYPE string VALUE 'so10',
            name TYPE string,
            language TYPE sylangu,
            client TYPE mandt,
            BEGIN OF content,
              header TYPE thead,
              lines TYPE STANDARD TABLE OF tline WITH EMPTY KEY,
            END OF content,
          END OF payload.
    payload-name = name.
    payload-language = language.
    payload-client = sy-mandt.
    CALL FUNCTION 'READ_TEXT'
      EXPORTING client = sy-mandt object = 'TEXT' name = text_name id = text_id language = language
      IMPORTING header = payload-content-header
      TABLES lines = payload-content-lines
      EXCEPTIONS not_found = 1 OTHERS = 2.
    IF sy-subrc <> 0.
      result = VALUE #( status = 422 body = '{"error":"SAP could not read the text"}' ).
      RETURN.
    ENDIF.
    " Recheck the returned header in case the text changed after the preflight.
    IF payload-content-header-tdrefobj IS NOT INITIAL OR payload-content-header-tdrefname IS NOT INITIAL
        OR payload-content-header-tdrefid IS NOT INITIAL.
      result = VALUE #( status = 409 body = '{"error":"Referenced texts are not supported"}' ).
      RETURN.
    ENDIF.
    result = VALUE #( status = 200 body = /ui2/cl_json=>serialize( data = payload pretty_name = /ui2/cl_json=>pretty_mode-low_case ) ).
  ENDMETHOD.

  METHOD read_sapscript.
    DATA form_name TYPE tdform.
    form_name = name.
    AUTHORITY-CHECK OBJECT 'S_SCRP_FRM'
      ID 'FORMNAME' FIELD form_name ID 'LANGUAGE' FIELD language ID 'ACTVT' FIELD '03'.
    DATA(allowed) = xsdbool( sy-subrc = 0 ).
    TEST-SEAM form_authority.
    END-TEST-SEAM.
    IF allowed = abap_false.
      result = VALUE #( status = 403 body = '{"error":"Display authorization required"}' ).
      RETURN.
    ENDIF.
    DATA: BEGIN OF payload,
            version TYPE i VALUE 1,
            kind TYPE string VALUE 'sapscript',
            name TYPE string,
            language TYPE sylangu,
            client TYPE mandt,
            BEGIN OF content,
              header TYPE itcta,
              lines TYPE STANDARD TABLE OF tline WITH EMPTY KEY,
              pages TYPE STANDARD TABLE OF itctg WITH EMPTY KEY,
              windows TYPE STANDARD TABLE OF itctw WITH EMPTY KEY,
              page_windows TYPE STANDARD TABLE OF itcth WITH EMPTY KEY,
              paragraphs TYPE STANDARD TABLE OF itcdp WITH EMPTY KEY,
              strings TYPE STANDARD TABLE OF itcds WITH EMPTY KEY,
              tabs TYPE STANDARD TABLE OF itcdq WITH EMPTY KEY,
            END OF content,
          END OF payload.
    payload-name = name.
    payload-language = language.
    payload-client = sy-mandt.
    DATA found TYPE c LENGTH 1.
    CALL FUNCTION 'READ_FORM'
      EXPORTING client = sy-mandt form = form_name language = language
                throughclient = space throughlanguage = space status = space
      IMPORTING found = found form_header = payload-content-header
      TABLES form_lines = payload-content-lines pages = payload-content-pages windows = payload-content-windows
             page_windows = payload-content-page_windows paragraphs = payload-content-paragraphs
             strings = payload-content-strings tabs = payload-content-tabs
      EXCEPTIONS OTHERS = 1.
    IF sy-subrc <> 0.
      result = VALUE #( status = 422 body = '{"error":"SAP could not read the form"}' ).
    ELSEIF found IS INITIAL.
      result = VALUE #( status = 404 body = '{"error":"Form not found in current client and language"}' ).
    ELSE.
      result = VALUE #( status = 200 body = /ui2/cl_json=>serialize( data = payload pretty_name = /ui2/cl_json=>pretty_mode-low_case ) ).
    ENDIF.
  ENDMETHOD.

  METHOD read_smartform.
    DATA form_name TYPE tdsfname.
    form_name = name.
    SELECT SINGLE devclass FROM tadir INTO @DATA(package)
      WHERE pgmid = 'R3TR' AND object = 'SSFO' AND obj_name = @form_name.
    AUTHORITY-CHECK OBJECT 'S_DEVELOP'
      ID 'DEVCLASS' FIELD package ID 'OBJTYPE' FIELD 'SSFO' ID 'OBJNAME' FIELD form_name
      ID 'P_GROUP' DUMMY ID 'ACTVT' FIELD '03'.
    DATA(allowed) = xsdbool( sy-subrc = 0 ).
    TEST-SEAM smartform_authority.
    END-TEST-SEAM.
    IF allowed = abap_false.
      result = VALUE #( status = 403 body = '{"error":"SmartForm display authorization required"}' ).
      RETURN.
    ENDIF.
    DATA(form) = NEW cl_ssf_fb_smart_form( ).
    TRY.
        " SHOW performs SAP's Workbench permission check without acquiring an edit lock.
        form->enqueue( mode = 'SHOW' formname = form_name ).
        form->load( im_formname = form_name im_language = language im_active = 'X' ).
        DATA(document) = cl_ixml=>create( )->create_document( ).
        form->xml_init( ).
        form->xml_download( EXPORTING parent = document CHANGING document = document ).
        DATA(root) = document->get_root_element( ).
        root->set_attribute( name = 'xmlns:sf' value = cl_ssf_fb_sf_basis=>xml_ns_uri_sf ).
        root->set_attribute( name = 'xmlns' value = cl_ssf_fb_sf_basis=>xml_ns_uri_ifr ).
        DATA xml TYPE xstring.
        CALL FUNCTION 'SDIXML_DOM_TO_XML'
          EXPORTING document = document
          IMPORTING xml_as_string = xml
          EXCEPTIONS OTHERS = 1.
        IF sy-subrc <> 0 OR xml IS INITIAL.
          result = VALUE #( status = 422 body = '{"error":"SmartForm XML conversion failed"}' ).
          RETURN.
        ENDIF.
        DATA: BEGIN OF payload,
                version TYPE i VALUE 1,
                kind TYPE string VALUE 'smartform',
                name TYPE string,
                language TYPE sylangu,
                client TYPE mandt,
                BEGIN OF content,
                  xml TYPE string,
                END OF content,
              END OF payload.
        payload-name = name.
        payload-language = language.
        payload-client = sy-mandt.
        payload-content-xml = cl_abap_codepage=>convert_from( xml ).
        result = VALUE #( status = 200 body = /ui2/cl_json=>serialize( data = payload pretty_name = /ui2/cl_json=>pretty_mode-low_case ) ).
      CATCH cx_ssf_fb INTO DATA(error).
        IF error->textid = cx_ssf_fb=>no_form OR error->textid = cx_ssf_fb=>no_active_source OR error->textid = cx_ssf_fb=>no_source.
          result = VALUE #( status = 404 body = '{"error":"Active SmartForm not found"}' ).
        ELSEIF error->textid = cx_ssf_fb=>no_show_permission.
          result = VALUE #( status = 403 body = '{"error":"SmartForm display authorization required"}' ).
        ELSE.
          result = VALUE #( status = 422 body = '{"error":"SAP could not export the SmartForm"}' ).
        ENDIF.
    ENDTRY.
  ENDMETHOD.
ENDCLASS.
